"""Unified ChatOpenAI factory for all LLM consumers."""

from __future__ import annotations

import re
from typing import Any

from langchain_openai import ChatOpenAI

from src.core.config import Settings, get_settings
from src.llm.providers import get_provider, normalize_openai_base_url, resolve_provider_id

DEFAULT_MODEL = "qwen2.5-72b-instruct"
DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"

# DeepSeek V4 thinking + LangChain tool-call 需回传 reasoning_content，暂不可用
_DEEPSEEK_V4_PATTERN = re.compile(r"deepseek[-_/ ]?v4", re.IGNORECASE)
_THINKING_DISABLED_EXTRA_BODY = {"thinking": {"type": "disabled"}}


def is_deepseek_v4_model(model_name: str | None) -> bool:
    if not model_name or not str(model_name).strip():
        return False
    return bool(_DEEPSEEK_V4_PATTERN.search(str(model_name).strip()))


def _merge_deepseek_v4_extra_body(
    model_name: str, extra_kwargs: dict[str, Any]
) -> dict[str, Any]:
    if not is_deepseek_v4_model(model_name):
        return extra_kwargs
    merged = dict(extra_kwargs)
    extra_body = dict(merged.get("extra_body") or {})
    extra_body.update(_THINKING_DISABLED_EXTRA_BODY)
    merged["extra_body"] = extra_body
    return merged


def _resolve_base_url(settings: Settings, base_url: str | None) -> str:
    """
    解析并返回基础URL，优先级顺序为：显式传入的base_url > settings中的base_url > 根据LLM提供商解析的URL > 默认URL
    
    Args:
        settings (Settings): 包含配置信息的设置对象
        base_url (str | None): 显式传入的基础URL，可能为None
    
    Returns:
        str: 解析后的基础URL字符串
    """
    # 尝试使用显式提供的base_url或settings中的base_url
    explicit = (base_url or settings.base_url or "").strip()
    if explicit:
        try:
            return normalize_openai_base_url(explicit)
        except ValueError:
            return explicit.rstrip("/")
    
    # 如果没有显式指定，则根据LLM提供商解析base_url
    provider_id = settings.llm_provider or resolve_provider_id(settings.base_url)
    profile = get_provider(provider_id)
    if profile:
        return profile.base_url
    
    # 如果以上都失败，返回默认的基础URL
    return DEFAULT_BASE_URL


def build_chat_model(
    *,
    temperature: float = 0,
    model: str | None = None,
    api_key: str | None = None,
    base_url: str | None = None,
    apply_profile: bool = True,
    **extra_kwargs: Any,
) -> ChatOpenAI:
    """
    构建并返回一个ChatOpenAI实例，支持配置模型参数和应用模型配置文件
    
    Args:
        temperature: 控制模型输出随机性的温度参数，默认为0
        model: 指定使用的模型名称，如果为None则使用默认设置
        api_key: OpenAI API密钥，如果为None则从设置中获取
        base_url: API基础URL，如果为None则从设置中解析
        apply_profile: 是否应用模型配置文件，默认为True
        **extra_kwargs: 传递给ChatOpenAI的额外参数
    
    Returns:
        配置好的ChatOpenAI实例
    """
    # 解析模型、API密钥和基础URL，优先级：传入参数 > 设置 > 默认值
    settings = get_settings()
    resolved_model = model or settings.deepagent_model or DEFAULT_MODEL
    resolved_key = api_key if api_key is not None else settings.api_key
    resolved_base = _resolve_base_url(settings, base_url)
    llm_kwargs = _merge_deepseek_v4_extra_body(resolved_model, dict(extra_kwargs))

    chat = ChatOpenAI(
        model=resolved_model,
        temperature=temperature,
        api_key=resolved_key,
        base_url=resolved_base,
        **llm_kwargs,
    )
    # 如果需要应用模型配置文件，则导入相关模块并应用配置
    if apply_profile:
        from src.service.model_context import (
            apply_model_profile,
            resolve_max_input_tokens,
        )

        apply_model_profile(chat, resolve_max_input_tokens(settings))
    return chat
