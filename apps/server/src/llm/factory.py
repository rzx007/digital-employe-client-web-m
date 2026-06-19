"""Unified ChatOpenAI factory for all LLM consumers."""

from __future__ import annotations

import re
from typing import Any

import httpx
from langchain_openai import ChatOpenAI

from src.core.config import Settings, get_settings
from src.llm.cache_chat_model import PromptCacheChatOpenAI, build_prompt_cache_strategy
from src.llm.providers import get_provider, normalize_openai_base_url, resolve_provider_id

# 输出 token 上限档位：重活/轻活的本质=单请求输出预算，不再用作并发槽位分级。
# 由组长/总管派单时为每个子任务指定档位；直接聊天用 standard 默认。
# 给模型设 max_tokens 后 llama.cpp 端 n_predict 即受限，单请求不会无限生成、长时间占 GPU slot。
OUTPUT_TOKENS_BY_TIER: dict[str, int] = {
    "small": 1024,      # 轻活：问答、组长拆解/派活说明、简短结论
    "standard": 16384,  # 默认：一般任务、直接聊天
    "large": 65536,     # 重活：长文档/报告生成（Word/PPT/PDF 专员）
}
DEFAULT_OUTPUT_TIER = "standard"


def resolve_output_tokens(tier_or_tokens: str | int | None) -> int | None:
    """把档位名(small/standard/large)或原始 token 数解析为 max_tokens；None→标准默认。"""
    if tier_or_tokens is None:
        return OUTPUT_TOKENS_BY_TIER[DEFAULT_OUTPUT_TIER]
    if isinstance(tier_or_tokens, int):
        return tier_or_tokens if tier_or_tokens > 0 else None
    key = str(tier_or_tokens).strip().lower()
    return OUTPUT_TOKENS_BY_TIER.get(key, OUTPUT_TOKENS_BY_TIER[DEFAULT_OUTPUT_TIER])


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
    # read 超时 = 流式「两个 chunk 之间」的最长等待。设 None（无限）：判「模型是否挂死」
    # 完全交给应用层「看活动」看门狗——长命令/长任务期间工具 stdout + 30s 心跳持续刷新
    # 活动时间戳，不会被底层 HTTP 误杀；模型真挂死（连续无任何活动）由 stream_registry 的
    # 900s no_content watchdog cancel 回收。connect/write/pool 仍有限，不放大。
    read_timeout = None
    llm_timeout = httpx.Timeout(
        connect=connect_cap,
        read=read_timeout,
        write=30.0,
        pool=connect_cap,
    )

    # 不再显式 new httpx.AsyncClient/Client 传给 ChatOpenAI！历史教训：
    # build_chat_model 常在「工具执行线程 / 派单线程」里被调用（非主事件循环），
    # 提前 new 的 AsyncClient 其连接池会绑到错误的事件循环；等流在主循环上真正发请求时
    # 跨循环使用 → 连接建不起来/被本地强制重置（observed: 本地模型空闲、网络正常，
    # 请求却 WinError 10054 _call_connection_lost）。让 ChatOpenAI/openai SDK 自己在
    # 「首次使用、当前运行的循环」上惰性创建客户端，绑定正确循环；瞬时重置由 max_retries 兜。
    chat: ChatOpenAI = PromptCacheChatOpenAI(
        model=resolved_model,
        temperature=temperature,
        api_key=resolved_key,
        base_url=resolved_base,
        timeout=llm_timeout,
        # 连接错误 / 首包超时 / 5xx 时自动重试，避免单次抖动就让整个流失败。
        # 注意：这只对「请求级失败」重试，不会重试已开始的流式中途卡住——那由
        # read_timeout 断连 + 应用层 watchdog 负责。
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
