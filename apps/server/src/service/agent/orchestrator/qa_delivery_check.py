"""QA 代码兜底（#3）：核验员工自报的二进制交付物是否真实落盘且非空。

补 P0-A 的短板——P0-A 让总管「判达标前抽检」，但抽不抽全靠模型遵从。这里在
**总管读到的执行快照里**注入一条代码核验：若员工产出文本里自报了交付物却在共享
产物区找不到对应的**非空**文件，就明确标出「疑似假交付」，让总管即便没主动抽检
也会看到、据此打回。

自报判定（控误报）：① 二进制交付物（docx/pptx/xlsx/pdf）全文匹配（高信号）；
② 其余交付物类文件仅在含「交付动词」（生成/保存/导出…）的行里取，且排除脚本/
依赖扩展名（跑完即删属正常）。员工没明确点名交付文件时不报。
"""
from __future__ import annotations

import logging
import re
from pathlib import Path

logger = logging.getLogger(__name__)

# 自报的二进制交付物文件名（含中文名）；这四类「格式即交付」全文匹配（高信号）。
_BINARY_DELIVERABLE_RE = re.compile(
    r"([\w一-鿿\-]+\.(?:docx|pptx|xlsx|pdf))", re.IGNORECASE
)
# 一般文件名：扩展名须以字母开头（排除 9.9k / v1.2 这类非文件）。
_FILENAME_RE = re.compile(r"([\w一-鿿\-]+\.[A-Za-z][A-Za-z0-9]{0,5})")
# 「交付动词」：仅当文件名所在行含这些词，才视为员工自报的交付物（防把读过/提到的文件误判）。
_DELIVERY_VERBS = (
    "生成", "保存", "导出", "创建", "写入", "输出", "产出",
    "另存", "存为", "存到", "做好", "交付", "已存", "落盘",
)
# 脚本/依赖扩展名：跑完即删属正常，缺失不算假交付（口径对齐前端 file-change-utils）。
_INTERMEDIATE_EXTS = frozenset({
    "ts", "tsx", "js", "jsx", "json", "py", "sql", "css", "java", "go",
    "rs", "cpp", "c", "h", "sh", "bat", "ps1", "rb", "lock", "toml",
    "ini", "cfg", "yaml", "yml",
})
_BINARY_EXTS = frozenset({"docx", "pptx", "xlsx", "pdf"})


def _basename(p: str) -> str:
    return p.rsplit("/", 1)[-1].rsplit("\\", 1)[-1]


def _ext_of(name: str) -> str:
    return name.rsplit(".", 1)[-1].lower() if "." in name else ""


def extract_claimed_files(text: str) -> list[str]:
    """从产出文本抽出员工**自报已交付**的文件名（basename，去重保序）。

    两路：① 二进制交付物（docx/pptx/xlsx/pdf）全文匹配；② 其余「交付物类」文件仅在
    含「交付动词」的行里取（排除脚本/依赖扩展名——删了不算假交付，防误报）。
    """
    if not text:
        return []
    seen: set[str] = set()
    out: list[str] = []

    def _add(base: str) -> None:
        key = base.lower()
        if key not in seen:
            seen.add(key)
            out.append(base)

    # ① 二进制交付物：高信号，全文匹配
    for m in _BINARY_DELIVERABLE_RE.findall(text):
        _add(_basename(m))

    # ② 交付动词句里的非脚本文件
    for line in text.splitlines():
        if not any(v in line for v in _DELIVERY_VERBS):
            continue
        for fn in _FILENAME_RE.findall(line):
            base = _basename(fn)
            ext = _ext_of(base)
            if ext in _INTERMEDIATE_EXTS or ext in _BINARY_EXTS:
                continue  # 脚本/依赖跳过；二进制已在 ① 处理
            _add(base)

    return out


def extract_claimed_binary_files(text: str) -> list[str]:
    """（保留）仅抽二进制交付物文件名。"""
    if not text:
        return []
    seen: set[str] = set()
    out: list[str] = []
    for m in _BINARY_DELIVERABLE_RE.findall(text):
        base = _basename(m)
        if base.lower() not in seen:
            seen.add(base.lower())
            out.append(base)
    return out


def detect_missing_delivery_artifacts(
    output_text: str,
    artifacts_dir: Path,
    this_turn_names: set[str] | None = None,
) -> str | None:
    """核验员工自报的交付物，发现问题返回告警，否则 None。两类问题：
    ① **缺失/空壳**：自报已交付却在产物区找不到对应非空文件。
    ② **旧产物充数**：磁盘上有该文件、但它**不在本轮写入**（共享累积目录里的历史残留）
       —— 仅当传入 `this_turn_names`（本会话 file_outputs 的 basename 小写集）时才判这档；
       这是补「文件存在≠本次产出」的核心防线（旧产物会骗过纯存在性核验）。

    容错：任何异常都返回 None（兜底核验不该影响主流程）。
    """
    try:
        claimed = extract_claimed_files(output_text)
        if not claimed:
            return None
        adir = Path(artifacts_dir)
        if not adir.is_dir():
            return None

        # 一次性建索引：basename(小写) -> 该名下所有文件的最大字节数。
        size_by_name: dict[str, int] = {}
        for p in adir.rglob("*"):
            try:
                if p.is_file():
                    name = p.name.lower()
                    size = p.stat().st_size
                    if size > size_by_name.get(name, -1):
                        size_by_name[name] = size
            except OSError:
                continue

        missing: list[str] = []
        stale: list[str] = []
        for fname in claimed:
            best = size_by_name.get(fname.lower())
            if best is None or best <= 0:  # 不存在 或 空壳
                missing.append(fname)
            elif this_turn_names is not None and fname.lower() not in this_turn_names:
                # 文件在、非空，但本轮根本没写它 → 共享目录里的旧产物
                stale.append(fname)

        parts: list[str] = []
        if missing:
            parts.append(
                "员工自报已交付 "
                + "、".join(missing)
                + "，但产物区找不到对应的非空文件（疑似假交付/空壳）"
            )
        if stale:
            parts.append(
                "员工自报已交付 "
                + "、".join(stale)
                + "，但该文件**本轮并未写入**、是共享目录里的历史旧产物"
                "（疑似拿旧产物充数/本次未真正产出）"
            )
        if not parts:
            return None
        return (
            "⚠️ 代码抽检："
            + "；".join(parts)
            + "——务必 redispatch_task 打回核实，勿据自报放行。"
        )
    except Exception:
        logger.debug("detect_missing_delivery_artifacts failed", exc_info=True)
        return None


def _resolve_artifacts_dir(db, conversation_id: int) -> Path | None:
    """据员工会话解析其项目共享产物区（与 agent.py 同一套解析）。失败返回 None。"""
    try:
        from src.models.conversation import Conversation
        from src.service.agent.paths import SERVICE_DIR
        from src.service.agent.workspace_paths import resolve_workspace_dirs
        from src.service.product_paths import resolve_conversation_product_root

        conv = db.get(Conversation, conversation_id)
        if conv is None:
            return None
        product_root = resolve_conversation_product_root(db, conv)
        if product_root is None:
            return None
        ws = resolve_workspace_dirs(root_path=str(product_root), base_dir=SERVICE_DIR)
        return ws.artifacts_dir
    except Exception:
        logger.debug("_resolve_artifacts_dir failed", exc_info=True)
        return None


def _this_turn_names(db, conversation_id: int) -> set[str] | None:
    """该员工会话本轮写入文件的 basename(小写) 集，供「旧产物充数」核验。

    源是 per-turn 执行日志（assistant 消息 extra_meta.file_outputs，含 write/edit/bash
    写的文件），由 `_conversation_file_outputs` 聚合。解析失败返回 None（=不启用旧产物
    核验，回退到纯存在性核验，避免 file_outputs 链路异常时误报）。
    """
    try:
        from src.service.orchestration_lifecycle import _conversation_file_outputs

        outputs = _conversation_file_outputs(db, conversation_id)
        return {Path(o["path"]).name.lower() for o in outputs if o.get("path")}
    except Exception:
        logger.debug("_this_turn_names failed", exc_info=True)
        return None


def check_log_delivery(db, log) -> str | None:
    """对一条已成功的执行日志做交付物兜底核验（供执行快照注入）。无问题/不适用→None。"""
    try:
        if log is None or getattr(log, "run_status", None) not in ("success", "completed"):
            return None
        conversation_id = getattr(log, "conversation_id", None)
        if not conversation_id:
            return None
        from src.service.orchestrator_execution_summary import (
            extract_execution_output_text,
        )

        output_text = extract_execution_output_text(log.output_json, 4000) or (
            log.run_result or ""
        )
        adir = _resolve_artifacts_dir(db, conversation_id)
        if adir is None:
            return None
        return detect_missing_delivery_artifacts(
            output_text, adir, this_turn_names=_this_turn_names(db, conversation_id)
        )
    except Exception:
        logger.debug("check_log_delivery failed", exc_info=True)
        return None
