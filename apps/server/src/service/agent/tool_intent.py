"""自研 Agent 工具共用的可选 intent 参数（仅 UI 展示，不参与业务逻辑）。"""

from __future__ import annotations

INTENT_MAX_LENGTH = 20

INTENT_PARAM_DOC = (
    "intent: 可选，给用户界面展示的一句中文（20字以内），"
    "写正在做的事/业务目的；勿复述工具名、参数名、员工 ID、文件名或路径。"
)

INTENT_PARAM_DOC_ZH = INTENT_PARAM_DOC


def drop_intent(intent: str | None = None) -> None:
    """丢弃 intent，避免传入业务函数。"""
    del intent
