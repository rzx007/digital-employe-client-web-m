"""工作台编排工具：在工作台页面的对话里操控看板（总管/装了 workbench-builder 技能的员工通用）。

本工具不直接改工作台配置（配置存在浏览器 localStorage，服务端触达不到），
只负责校验 + 归一化指令，把结果回吐给前端；前端 workbench-arrange handler
事务性地把指令应用到本地工作台配置。

conversation_id 取法：优先注入的 LangChain runtime（员工/总管通用），
回退 orchestrator context var（总管旧路径）。
"""

from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import PurePath

from langchain.tools import ToolRuntime
from langchain_core.tools import tool

from src.core.config import get_settings
from src.service.agent.orchestrator.runtime import (
    conversation_id_from_runtime,
    get_conversation_id,
)


SPAN_PRESETS: dict[str, dict[str, int]] = {
    "small": {"w": 3, "h": 2},
    "medium": {"w": 6, "h": 3},
    "large": {"w": 6, "h": 6},
    "full": {"w": 12, "h": 6},
}

_KNOWN_OPS = {"pin", "resize", "move", "rename", "hide", "remove", "reorder"}

# 回吐结果里的 marker，前端 handler 据此识别并解析 operations。
ARRANGE_RESULT_MARKER = "WORKBENCH_ARRANGE_V1"


def _normalize_span(span: object) -> dict[str, int] | None:
    """把 span（档位字符串或 {w,h}）归一化为 {w,h}；非法返回 None。"""
    if isinstance(span, str):
        return SPAN_PRESETS.get(span)
    if isinstance(span, dict) and isinstance(span.get("w"), int) and isinstance(span.get("h"), int):
        return {"w": span["w"], "h": span["h"]}
    return None


def _normalize_pos(pos: object) -> dict[str, int] | None:
    """把 pos 归一化为 {x,y} 整数；x/y 非数字（如 null、字符串）则返回 None，
    避免 int() 抛异常击穿外层的「返回错误字符串」契约。"""
    if not isinstance(pos, dict):
        return None
    try:
        return {"x": int(pos.get("x", 0)), "y": int(pos.get("y", 0))}
    except (TypeError, ValueError):
        return None


def normalize_operations(
    ops: object,
    resolve_path: Callable[[str], str | None],
) -> tuple[list[dict], list[str]]:
    """校验并归一化一批 operations。

    返回 (归一化后的合法 operations, 错误信息列表)。
    - pin 的 resourcePath（模型给的文件名 / 路径）经 resolve_path 解析为**真实绝对磁盘路径**；
      解析不到（产物不存在）则记错误且该 op 丢弃。归一化后的 pin 携带真实绝对路径，
      与手动钉/资源管理器同一套（前端 content API 凭此取源码）。
    - span 档位字符串归一化为 {w,h}。
    - 未知 op 记错误且丢弃。
    ops 必须是 list，否则抛 ValueError。
    """
    if not isinstance(ops, list):
        raise ValueError("operations 必须是 JSON 数组")

    out: list[dict] = []
    errors: list[str] = []

    for i, op in enumerate(ops):
        if not isinstance(op, dict) or op.get("op") not in _KNOWN_OPS:
            errors.append(f"operations[{i}]：未知或非法指令 {op!r}")
            continue
        kind = op["op"]

        if kind == "pin":
            ref = op.get("resourcePath")
            real_path = resolve_path(ref) if isinstance(ref, str) else None
            if real_path is None:
                hint = ""
                available = getattr(resolve_path, "available_names", None)
                if available:
                    hint = f"当前可钉的 .html：{', '.join(sorted(available))}。"
                else:
                    hint = "当前会话还没有 .html 产物，请先用 write_file 生成。"
                errors.append(
                    f"operations[{i}]：产物 {ref!r} 找不到。{hint}"
                )
                continue
            norm = {"op": "pin", "resourcePath": real_path}
            if isinstance(op.get("title"), str):
                norm["title"] = op["title"]
            if "span" in op:
                span = _normalize_span(op["span"])
                if span is None:
                    errors.append(f"operations[{i}]：span 非法 {op['span']!r}")
                    continue
                norm["span"] = span
            if "pos" in op:
                pos = _normalize_pos(op["pos"])
                if pos is None:
                    errors.append(f"operations[{i}]：pin 的 pos 非法 {op['pos']!r}")
                    continue
                norm["pos"] = pos
            out.append(norm)

        elif kind == "resize":
            span = _normalize_span(op.get("span"))
            if span is None or not isinstance(op.get("blockRef"), str):
                errors.append(f"operations[{i}]：resize 缺 blockRef 或 span 非法")
                continue
            out.append({"op": "resize", "blockRef": op["blockRef"], "span": span})

        elif kind == "move":
            pos = _normalize_pos(op.get("pos"))
            if not isinstance(op.get("blockRef"), str) or pos is None:
                errors.append(f"operations[{i}]：move 缺 blockRef 或 pos 非法")
                continue
            out.append({"op": "move", "blockRef": op["blockRef"], "pos": pos})

        elif kind == "rename":
            if not isinstance(op.get("blockRef"), str) or not isinstance(op.get("title"), str):
                errors.append(f"operations[{i}]：rename 缺 blockRef 或 title")
                continue
            out.append({"op": "rename", "blockRef": op["blockRef"], "title": op["title"]})

        elif kind in ("hide", "remove"):
            if not isinstance(op.get("blockRef"), str):
                errors.append(f"operations[{i}]：{kind} 缺 blockRef")
                continue
            out.append({"op": kind, "blockRef": op["blockRef"]})

        elif kind == "reorder":
            order = op.get("order")
            if not isinstance(order, list) or not all(isinstance(x, str) for x in order):
                errors.append(f"operations[{i}]：reorder 的 order 必须是字符串数组")
                continue
            out.append({"op": "reorder", "order": order})

    return out, errors


def build_html_resolver_from_entries(
    entries: list[dict] | list,
) -> Callable[[str], str | None]:
    """从资源条目（每条含 name + 真实绝对 path）建一个解析器：

    给定模型提供的 resourcePath（文件名 / basename / 完整真实路径），
    返回对应的**真实绝对磁盘路径**；找不到或非 .html 返回 None。

    只收录 .html/.htm，索引键含：文件名、路径 basename、完整路径（多形式命中，对模型更宽容）。
    """
    index: dict[str, str] = {}
    for e in entries:
        name = e.get("name") if isinstance(e, dict) else getattr(e, "name", None)
        path = e.get("path") if isinstance(e, dict) else getattr(e, "path", None)
        if not isinstance(path, str):
            continue
        if PurePath(path).suffix.lower() not in (".html", ".htm"):
            continue
        index[path] = path
        index[PurePath(path).name] = path
        if isinstance(name, str) and name:
            index[name] = path

    def resolve(ref: str) -> str | None:
        if not isinstance(ref, str) or not ref:
            return None
        if ref in index:
            return index[ref]
        # 容错：模型给了带目录的相对/虚拟路径（如 /artifacts/x.html）→ 退到 basename 匹配
        return index.get(PurePath(ref).name)

    # 供错误提示列出"当前可钉的文件名"，让模型一步自纠。
    resolve.available_names = {PurePath(p).name for p in set(index.values())}
    return resolve


def _build_current_conversation_resolver(runtime=None) -> Callable[[str], str | None]:
    """用 ResourceService（与手动钉 / 资源管理器同一套）列出当前会话产物，建 .html 解析器。

    conversation_id：优先注入的 runtime（员工/总管通用），回退 orchestrator
    context var（总管旧路径）。

    复用 resource_service 意味着：正确的员工/总管工作空间布局
    （<root>/employee-<owner>/artifacts/conv-<cid>/）、房间共享、旧布局兼容全都到位。
    """
    cid = conversation_id_from_runtime(runtime)
    if cid is None:
        cid = get_conversation_id()
    if cid is None:
        return lambda _ref: None
    from src.service.resource_service import ResourceService

    listing = ResourceService.list_resources(get_settings().artifacts_path, int(cid))
    # 当前会话产物 + 员工工作空间（含历史 conv-*）+ 公共区，都允许钉。
    entries = [
        *listing.artifacts,
        *listing.workspace,
        *listing.public,
    ]
    return build_html_resolver_from_entries(entries)


@tool
def arrange_workbench(operations: str, runtime: ToolRuntime[None, None] = None) -> str:
    """编排工作台看板（在工作台页面的对话里可用）。

    operations 是 JSON 数组字符串，每条 op ∈ {pin, resize, move, rename, hide, remove, reorder}：
      - pin:     {"op":"pin","resourcePath":"x.html","title":"标题","span":"medium","pos":{"x":0,"y":0}}
                 span 可省（默认 medium），可填档位 small/medium/large/full 或 {"w":列,"h":行}；
                 pos 可省（自动找空位）。
                 resourcePath **直接填你生成的 .html 文件名**（如 "weibo-dashboard.html"）即可，
                 工具会自动在当前会话产物里定位真实路径——不要拼 /artifacts/ 前缀或绝对路径。
      - resize:  {"op":"resize","blockRef":"销售看板","span":"large"}
      - move:    {"op":"move","blockRef":"销售看板","pos":{"x":0,"y":0}}
      - rename:  {"op":"rename","blockRef":"销售看板","title":"新标题"}
      - hide:    {"op":"hide","blockRef":"销售看板"}
      - remove:  {"op":"remove","blockRef":"销售看板"}
      - reorder: {"op":"reorder","order":["看板A","看板B"]}
    blockRef = 看板当前标题或 1 基序号（你看不到内部 id，用标题/序号即可）。
    用户「放大/缩小」对应升降 span 档位；「放左上」对应 pos {x:0,y:0}；「并排」给相邻 x、相同 y。
    一次可传多条指令，会被一并应用（事务性）。
    """
    try:
        parsed = json.loads(operations)
    except json.JSONDecodeError as exc:
        return f"错误：operations 不是合法 JSON：{exc}"

    try:
        resolve_path = _build_current_conversation_resolver(runtime)
        normalized, errors = normalize_operations(parsed, resolve_path)
    except ValueError as exc:
        return f"错误：{exc}"

    if not normalized:
        detail = "；".join(errors) if errors else "没有可执行的指令"
        return f"错误：{detail}"

    payload = {"marker": ARRANGE_RESULT_MARKER, "operations": normalized}
    summary = f"已下发 {len(normalized)} 条工作台编排指令。"
    if errors:
        summary += f"（{len(errors)} 条被忽略：{'；'.join(errors)}）"
    # 回吐结构化 payload + 人类可读摘要，前端 handler 解析 marker 段。
    return f"{summary}\n{json.dumps(payload, ensure_ascii=False)}"
