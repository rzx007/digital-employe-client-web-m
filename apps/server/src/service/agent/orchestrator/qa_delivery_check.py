"""QA 代码兜底（#3）：核验员工自报的二进制交付物是否真实落盘且非空。

补 P0-A 的短板——P0-A 让总管「判达标前抽检」，但抽不抽全靠模型遵从。这里在
**总管读到的执行快照里**注入一条代码核验：若员工产出文本里自报了二进制交付物
（.docx/.pptx/.xlsx/.pdf）却在共享产物区找不到对应的**非空**文件，就明确标出
「疑似假交付」，让总管即便没主动抽检也会看到、据此打回。

只核「员工自报的具体文件」对不对得上磁盘（高信号、近零误报）——员工没点名具体
二进制文件时不报（那类含糊交付仍由 P0-A 的提示词抽检覆盖）。
"""
from __future__ import annotations

import logging
import re
from pathlib import Path

logger = logging.getLogger(__name__)

# 自报的二进制交付物文件名（含中文名）；只认这四类「格式即交付」的二进制产物。
_BINARY_DELIVERABLE_RE = re.compile(
    r"([\w一-鿿\-]+\.(?:docx|pptx|xlsx|pdf))", re.IGNORECASE
)


def extract_claimed_binary_files(text: str) -> list[str]:
    """从产出文本抽出自报的二进制交付物文件名（取 basename，去重保序，大小写不敏感去重）。"""
    if not text:
        return []
    seen: set[str] = set()
    out: list[str] = []
    for m in _BINARY_DELIVERABLE_RE.findall(text):
        base = m.rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
        key = base.lower()
        if key not in seen:
            seen.add(key)
            out.append(base)
    return out


def detect_missing_delivery_artifacts(
    output_text: str, artifacts_dir: Path
) -> str | None:
    """员工自报了二进制交付物却在产物区找不到对应非空文件 → 返回告警，否则 None。

    容错：任何异常都返回 None（兜底核验不该影响主流程）。
    """
    try:
        claimed = extract_claimed_binary_files(output_text)
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
        for fname in claimed:
            best = size_by_name.get(fname.lower())
            if best is None or best <= 0:  # 不存在 或 空壳
                missing.append(fname)

        if not missing:
            return None
        return (
            "⚠️ 代码抽检：员工自报已交付 "
            + "、".join(missing)
            + "，但产物区找不到对应的非空文件——疑似假交付/空壳，"
            "务必 redispatch_task 打回核实，勿据自报放行。"
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
        return detect_missing_delivery_artifacts(output_text, adir)
    except Exception:
        logger.debug("check_log_delivery failed", exc_info=True)
        return None
