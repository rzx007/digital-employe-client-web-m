"""LLM connection probe for settings UI and remote sync validation."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

import httpx

from src.core.config import get_settings
from src.llm.providers import (
    get_provider,
    normalize_openai_base_url,
    resolve_provider_id,
)

logger = logging.getLogger(__name__)

PROBE_TIMEOUT = 15.0


@dataclass(slots=True)
class ConnectionTestRequest:
    provider_id: str | None = None
    base_url: str | None = None
    api_key: str | None = None
    model: str | None = None


@dataclass(slots=True)
class ConnectionTestResult:
    ok: bool
    provider_id: str
    normalized_base_url: str
    model: str
    message: str


def _mask_key_hint(api_key: str | None) -> str:
    """
    对API密钥进行掩码处理，用于安全显示
    
    参数:
        api_key (str | None): 待处理的API密钥字符串，可能为None或空字符串
    
    返回值:
        str: 掩码后的密钥提示字符串
             - 如果原密钥为空或None，返回"(empty)"
             - 如果原密钥长度小于等于8，返回"***"
             - 否则返回前4位+...+后4位的格式
    """
    if not api_key:
        return "(empty)"
    
    # 去除首尾空白字符
    key = api_key.strip()
    
    # 长度较短时直接返回星号掩码
    if len(key) <= 8:
        return "***"
    
    # 返回部分可见的掩码格式：前4位和后4位保留，中间用...代替
    return f"{key[:4]}...{key[-4:]}"


def _summarize_response_body(body: str, limit: int = 200) -> str:
    """
    对响应体进行摘要处理，去除换行符并限制长度
    
    参数:
        body (str): 原始响应体字符串
        limit (int): 摘要的最大字符数，默认为200
    
    返回:
        str: 处理后的摘要字符串，如果原字符串超过限制则在末尾添加"..."
    """
    text = body.strip().replace("\n", " ")
    if len(text) <= limit:
        return text
    return f"{text[:limit]}..."


def _resolve_probe_context(
    payload: ConnectionTestRequest,
) -> tuple[str, str, str, str]:
    """
    解析探针上下文信息，从请求载荷中提取并验证必要的连接参数
    
    Args:
        payload: 连接测试请求对象，包含API连接所需的基本信息
        
    Returns:
        tuple[str, str, str, str]: 返回四元组，包含解析后的参数：
            - resolved_provider: 解析后的供应商ID
            - normalized: 标准化后的API基础URL
            - api_key: API密钥
            - model: 模型名称
            
    Raises:
        ValueError: 当必要参数缺失时抛出异常
    """
    # 提取并验证供应商ID
    provider_id = (payload.provider_id or "").strip() or None
    profile = get_provider(provider_id) if provider_id else None

    # 处理API基础URL，优先使用载荷中的URL，其次使用供应商配置文件中的URL
    base_url = (payload.base_url or "").strip()
    if not base_url and profile:
        base_url = profile.base_url

    if not base_url:
        raise ValueError("请填写 API 地址或选择已知供应商")

    # 标准化URL并解析供应商ID
    normalized = normalize_openai_base_url(base_url)
    resolved_provider = provider_id or resolve_provider_id(normalized)
    if resolved_provider == "custom" and profile:
        resolved_provider = profile.id

    # 验证API密钥，自定义供应商可以为空
    api_key = (payload.api_key or "").strip()
    if not api_key and resolved_provider != "custom":
        raise ValueError("请填写 API Key（自定义/本地无鉴权端点可留空）")

    # 处理模型名称，优先使用载荷中的模型名，其次使用供应商配置文件中的默认模型
    model = (payload.model or "").strip()
    if not model and profile and profile.default_models:
        model = profile.default_models[0]
    if not model:
        raise ValueError("请填写模型名称")

    return resolved_provider, normalized, api_key, model


def _probe_models_endpoint(
    client: httpx.Client,
    base_url: str,
    headers: dict[str, str],
) -> tuple[bool, str]:
    """
    探测模型端点是否存在并可访问
    
    Args:
        client: HTTP客户端实例
        base_url: 基础URL地址
        headers: HTTP请求头字典
    
    Returns:
        tuple[bool, str]: 返回二元组，第一个元素表示请求是否成功，第二个元素包含结果描述信息
    """
    url = f"{base_url.rstrip('/')}/models"
    try:
        response = client.get(url, headers=headers)
    except httpx.RequestError as exc:
        return False, f"GET /models 请求失败: {exc}"

    # 检查响应状态码是否为200
    if response.status_code == 200:
        return True, "GET /models 成功"

    # 获取响应体摘要用于错误信息
    body = _summarize_response_body(response.text)
    return False, f"GET /models HTTP {response.status_code}: {body}"


def _probe_chat_completions(
    client: httpx.Client,
    base_url: str,
    headers: dict[str, str],
    model: str,
) -> tuple[bool, str]:
    """
    探测聊天补全API端点是否可用
    
    参数:
        client (httpx.Client): HTTP客户端实例
        base_url (str): API基础URL
        headers (dict[str, str]): 请求头字典
        model (str): 要使用的模型名称
    
    返回:
        tuple[bool, str]: 包含探测结果和描述信息的元组
                         - (True, "成功信息") 表示API可用
                         - (False, "错误信息") 表示API不可用或出错
    """
    url = f"{base_url.rstrip('/')}/chat/completions"
    payload: dict[str, Any] = {
        "model": model,
        "messages": [{"role": "user", "content": "ping"}],
        "max_tokens": 1,
        "stream": False,
    }
    
    # 发送探测请求到chat/completions端点
    try:
        response = client.post(url, headers=headers, json=payload)
    except httpx.RequestError as exc:
        return False, f"POST /chat/completions 请求失败: {exc}"

    if response.status_code in (200, 201):
        return True, "POST /chat/completions 成功"

    # 获取响应体摘要用于错误信息
    body = _summarize_response_body(response.text)
    return False, f"POST /chat/completions HTTP {response.status_code}: {body}"


def _build_probe_headers(api_key: str) -> dict[str, str]:
    """
    构建探针请求的HTTP头信息
    
    Args:
        api_key (str): API密钥，用于身份验证
        
    Returns:
        dict[str, str]: 包含Content-Type和可选Authorization头的字典
    """
    headers: dict[str, str] = {"Content-Type": "application/json"}
    # 添加API密钥到Authorization头中
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    return headers


def test_connection(payload: ConnectionTestRequest) -> ConnectionTestResult:
    settings = get_settings()
    timeout = settings.skill_remote_timeout or PROBE_TIMEOUT

    try:
        resolved_provider, normalized, api_key, model = _resolve_probe_context(
            payload
        )
    except ValueError as exc:
        return ConnectionTestResult(
            ok=False,
            provider_id=payload.provider_id or "custom",
            normalized_base_url=(payload.base_url or "").strip(),
            model=(payload.model or "").strip(),
            message=str(exc),
        )

    headers = _build_probe_headers(api_key)
    logger.info(
        "LLM connection probe provider=%s base_url=%s model=%s key=%s",
        resolved_provider,
        normalized,
        model,
        _mask_key_hint(api_key),
    )

    with httpx.Client(timeout=timeout) as client:
        ok, detail = _probe_models_endpoint(client, normalized, headers)
        if not ok:
            chat_ok, chat_detail = _probe_chat_completions(
                client, normalized, headers, model
            )
            if chat_ok:
                ok, detail = chat_ok, chat_detail
            else:
                detail = f"{detail}; fallback: {chat_detail}"

    return ConnectionTestResult(
        ok=ok,
        provider_id=resolved_provider,
        normalized_base_url=normalized,
        model=model,
        message=detail if ok else f"连接失败: {detail}",
    )
