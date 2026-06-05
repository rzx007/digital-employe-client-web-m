"""Unified ChatOpenAI factory for all LLM consumers."""

from __future__ import annotations

import re
from typing import Any

import httpx
from langchain_openai import ChatOpenAI

from src.core.config import Settings, get_settings
from src.llm.cache_chat_model import PromptCacheChatOpenAI, build_prompt_cache_strategy
from src.llm.providers import get_provider, normalize_openai_base_url, resolve_provider_id

DEFAULT_MODEL = "qwen2.5-72b-instruct"
DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"
# OpenAI SDK / ChatOpenAI 要求非空 api_key；本地无鉴权端点可忽略该占位值
DEFAULT_API_KEY = "not-needed"

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
    resolved_key = (resolved_key or "").strip() or DEFAULT_API_KEY
    resolved_base = _resolve_base_url(settings, base_url)
    llm_kwargs = _merge_deepseek_v4_extra_body(resolved_model, dict(extra_kwargs))
    provider_id = settings.llm_provider or resolve_provider_id(resolved_base)
    cache_strategy = build_prompt_cache_strategy(
        base_url=resolved_base,
        provider_id=provider_id,
        config_mode=settings.prompt_cache_mode,
    )

    req_timeout = max(15.0, float(settings.llm_request_timeout))
    connect_cap = min(12.0, req_timeout)
    # read 超时 = 流式「两个 chunk 之间」的最长等待。本地模型正常两 chunk 间隔
    # 仅几秒；之前 read=300s（5分钟）意味着模型挂住后底层 HTTP 要干等 5 分钟才断，
    # 期间占着 llama.cpp slot、拖累其它请求。降到 90s：既宽松容纳大文档生成的
    # 间隙，又能在模型真挂住时较快断连、释放 slot。比应用层 chunk_timeout 略小，
    # 让「底层 HTTP 先断 → 释放 slot」先于「应用层判超时」发生。
    read_timeout = min(90.0, req_timeout)
    llm_timeout = httpx.Timeout(
        connect=connect_cap,
        read=read_timeout,
        write=30.0,
        pool=connect_cap,
    )

    # httpx 连接策略：禁用 keep-alive 连接复用（max_keepalive_connections=0）。
    # 根因——模型端会强制关闭空闲 keep-alive 连接（observed 大量
    # `WinError 10054 远程主机强迫关闭了连接`）；httpx 连接池一旦复用到这些已被
    # 重置的死连接，请求就卡在首包或流中途直到超时（observed 群聊偶发 120s 卡死、
    # 流中途拿几个 token 后僵住）。改为每次请求用新鲜连接，彻底规避复用死连接；
    # 代价是每次多一次 TCP/TLS 握手（几十 ms），换取不再卡死，值得。
    # 同步/异步客户端都设：agent 走 astream(异步)，非流式路径走同步。
    _http_limits = httpx.Limits(max_keepalive_connections=0)
    http_async_client = httpx.AsyncClient(timeout=llm_timeout, limits=_http_limits)
    http_sync_client = httpx.Client(timeout=llm_timeout, limits=_http_limits)

    chat: ChatOpenAI = PromptCacheChatOpenAI(
        model=resolved_model,
        temperature=temperature,
        api_key=resolved_key,
        base_url=resolved_base,
        timeout=llm_timeout,
        # 禁用复用的 httpx 客户端（见上方说明），杜绝复用被重置的死连接致卡死。
        http_async_client=http_async_client,
        http_client=http_sync_client,
        # 连接错误 / 首包超时 / 5xx 时自动重试，避免单次抖动就让整个流失败。
        # 注意：这只对「请求级失败」重试，不会重试已开始的流式中途卡住——那由
        # read_timeout 断连 + 应用层 watchdog（后续步骤）负责。
        max_retries=2,
        prompt_cache_strategy=cache_strategy,
        # 显式开启流式：agent 用 astream_events 消费，streaming=False 时 langchain
        # 走非流式合成事件，对部分端点(如本地 llama.cpp)收不到 [DONE] 结束帧会卡死
        # （模型 /slots is_processing=false 但应用永远 streaming）。开 streaming 后
        # 走标准 SSE，正确识别 data:[DONE] → astream 正常结束。
        streaming=True,
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
