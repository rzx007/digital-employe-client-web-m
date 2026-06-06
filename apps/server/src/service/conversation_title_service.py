"""Semantic conversation title generation from the first user message."""

from __future__ import annotations

import logging
import re
from typing import Literal

from src.core.config import get_settings

logger = logging.getLogger(__name__)

TitleSource = Literal["rule", "llm", "fallback"]

_MAX_TITLE_LEN = 20
_FALLBACK_MAX_LEN = 50

_GREETING_PATTERN = re.compile(
    r"^(?:hi|hello|hey|yo|"
    r"你好|您好|嗨|哈喽|在吗|在不在|早上好|下午好|晚上好|"
    r"good\s+morning|good\s+afternoon|good\s+evening"
    r")[\s!！?？。,.~]*$",
    re.IGNORECASE,
)

_THANKS_PATTERN = re.compile(
    r"^(?:thanks?|thank\s+you|thx|ty|"
    r"谢谢|多谢|感谢|辛苦了|thanks"
    r")[\s!！?？。,.~]*$",
    re.IGNORECASE,
)

_GOODBYE_PATTERN = re.compile(
    r"^(?:bye|goodbye|see\s+you|cya|"
    r"再见|拜拜|回见|下次见|晚安|good\s+night"
    r")[\s!！?？。,.~]*$",
    re.IGNORECASE,
)

_SMALLTALK_PATTERN = re.compile(
    r"^(?:test|testing|123|111|aaa|"
    r"测试|试试|试一下|在测试"
    r")[\s!！?？。,.~]*$",
    re.IGNORECASE,
)

_TITLE_SYSTEM = (
    "你是会话标题生成器。根据用户首条消息，输出一个简短的中文会话标题。"
    "要求：4-12 个汉字；概括用户意图；不要照抄原文；不要标点；"
    "不要解释；只输出标题本身。"
    "纯问候输出：问候语；纯测试/寒暄输出：简单对话；"
    "有明确任务时用动宾短语，如「周报撰写」「销售数据查询」。"
)


def normalize_title(raw: str) -> str:
    """Strip noise and clamp title length."""
    text = (raw or "").strip()
    text = text.strip("\"'“”‘’`")
    text = re.sub(r"[\r\n\t]+", " ", text)
    text = re.sub(r"[。！？!?…]+$", "", text).strip()
    if not text:
        return "新对话"
    if len(text) > _MAX_TITLE_LEN:
        text = text[:_MAX_TITLE_LEN].rstrip()
    return text or "新对话"


def match_rule_title(message: str) -> str | None:
    """Rule-based titles for common short utterances."""
    text = (message or "").strip()
    if not text:
        return None
    if _GREETING_PATTERN.match(text):
        return "问候语"
    if _THANKS_PATTERN.match(text):
        return "致谢"
    if _GOODBYE_PATTERN.match(text):
        return "告别"
    if _SMALLTALK_PATTERN.match(text):
        return "简单对话"
    return None


def build_title_prompt(message: str) -> list[dict[str, str]]:
    user = f"用户首条消息：\n{(message or '').strip()}"
    return [
        {"role": "system", "content": _TITLE_SYSTEM},
        {"role": "user", "content": user},
    ]


def fallback_conversation_title(message: str) -> str:
    text = (message or "").strip()
    if not text:
        return "新对话"
    return text[:_FALLBACK_MAX_LEN]


def _extract_model_content(content: object) -> str:
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, dict):
                parts.append(str(item.get("text", "")))
            else:
                parts.append(str(item))
        return "".join(parts)
    return str(content or "")


def _llm_configured() -> bool:
    settings = get_settings()
    api_key = (settings.api_key or "").strip()
    if api_key and api_key != "not-needed":
        return True
    return (settings.llm_provider or "custom") == "custom"


def _invoke_llm_title(message: str) -> str | None:
    if not _llm_configured():
        return None
    try:
        from src.llm.factory import build_chat_model

        model = build_chat_model(temperature=0, apply_profile=False)
        response = model.invoke(build_title_prompt(message))
        raw = _extract_model_content(getattr(response, "content", response))
        title = normalize_title(raw)
        if title in {"新对话", "简单对话"} and len(message.strip()) > 20:
            return None
        return title
    except Exception:
        logger.warning("conversation title LLM failed", exc_info=True)
        return None


def suggest_conversation_title(message: str) -> tuple[str, TitleSource]:
    """Suggest a semantic title: rule -> LLM -> fallback."""
    rule_title = match_rule_title(message)
    if rule_title:
        return normalize_title(rule_title), "rule"

    llm_title = _invoke_llm_title(message)
    if llm_title:
        return llm_title, "llm"

    return normalize_title(fallback_conversation_title(message)), "fallback"
