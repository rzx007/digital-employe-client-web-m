"""Static LLM provider catalog for OpenAI-compatible vendors."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal
from urllib.parse import urlparse

from src.llm.providers.url import normalize_openai_base_url

LlmProviderId = Literal[
    "dashscope",
    "deepseek",
    "openai",
    "moonshot",
    "zhipu",
    "siliconflow",
    "custom",
]


def normalize_model_id(model_id: str) -> str:
    """Normalize model id for catalog/heuristic matching (lowercase, path suffix)."""
    return model_id.strip().lower().split("/")[-1]


@dataclass(frozen=True, slots=True)
class ProviderProfile:
    id: LlmProviderId
    display_name: str
    base_url: str
    url_hosts: tuple[str, ...]
    default_models: tuple[str, ...]
    vision_models: frozenset[str] = frozenset()
    suggested_max_input_tokens: int | None = None
    dashscope_error_patch: bool = False


_PROVIDERS: tuple[ProviderProfile, ...] = (
    ProviderProfile(
        id="dashscope",
        display_name="阿里云 DashScope",
        base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
        url_hosts=("dashscope.aliyuncs.com",),
        default_models=(
            "deepseek-v4-flash",
            "deepseek-v4-pro",
            "qwen3-vl-plus",
            "qwen3-vl-flash",
            "qwen-vl-max",
            "qwen2.5-72b-instruct",
            "qwen3.7-plus",
            "qwen3.6-plus",
            "kimi-k2.6",
            "kimi-k2.5",
        ),
        # 百炼 VL / 统一多模态：视觉理解 + qwen-vl OpenAI 兼容 + Kimi 多模态文档
        vision_models=frozenset(
            {
                "qwen3-vl-plus",
                "qwen3-vl-flash",
                "qwen-vl-max",
                "qwen-vl-plus",
                "qwen2.5-vl-72b-instruct",
                "qwen3.7-plus",
                "qwen3.6-plus",
                "qwen3.6-flash",
                "qwen3.5-plus",
                "kimi-k2.5",
                "kimi-k2.6",
            }
        ),
        suggested_max_input_tokens=120000,
        dashscope_error_patch=True,
    ),
    ProviderProfile(
        id="deepseek",
        display_name="DeepSeek 官方",
        base_url="https://api.deepseek.com/v1",
        url_hosts=("api.deepseek.com",),
        default_models=("deepseek-v4-flash", "deepseek-v4-pro"),
        suggested_max_input_tokens=120000,
    ),
    ProviderProfile(
        id="openai",
        display_name="OpenAI",
        base_url="https://api.openai.com/v1",
        url_hosts=("api.openai.com",),
        default_models=(
            "gpt-4.1",
            "gpt-4.1-mini",
            "gpt-4o",
            "gpt-4o-mini",
        ),
        vision_models=frozenset(
            {
                "gpt-4o",
                "gpt-4o-mini",
                "gpt-4.1",
                "gpt-4.1-mini",
                "gpt-4.1-nano",
            }
        ),
        suggested_max_input_tokens=120000,
    ),
    ProviderProfile(
        id="moonshot",
        display_name="Moonshot (Kimi)",
        base_url="https://api.moonshot.cn/v1",
        url_hosts=("api.moonshot.cn",),
        default_models=(
            "kimi-k2.6",
            "moonshot-v1-8k-vision-preview",
            "moonshot-v1-8k",
            "moonshot-v1-32k",
            "moonshot-v1-128k",
        ),
        vision_models=frozenset(
            {
                "kimi-k2.6",
                "kimi-k2.5",
                "moonshot-v1-8k-vision-preview",
                "moonshot-v1-32k-vision-preview",
                "moonshot-v1-128k-vision-preview",
            }
        ),
        suggested_max_input_tokens=120000,
    ),
    ProviderProfile(
        id="zhipu",
        display_name="智谱 AI",
        base_url="https://open.bigmodel.cn/api/paas/v4",
        url_hosts=("open.bigmodel.cn",),
        default_models=(
            "glm-5.1",
            "glm-5",
            "glm-5-turbo",
            "glm-4v-flash",
            "glm-4.7",
            "glm-4.6",
        ),
        vision_models=frozenset(
            {
                "glm-5v-turbo",
                "glm-4.6v",
                "glm-4.5v",
                "glm-4v",
                "glm-4v-flash",
                "glm-4v-plus",
                "glm-4v-plus-0111",
            }
        ),
        suggested_max_input_tokens=120000,
    ),
    ProviderProfile(
        id="siliconflow",
        display_name="SiliconFlow",
        base_url="https://api.siliconflow.cn/v1",
        url_hosts=("api.siliconflow.cn",),
        default_models=(
            "Qwen/Qwen3-VL-32B-Instruct",
            "Qwen/Qwen3-VL-8B-Instruct",
            "deepseek-ai/DeepSeek-V3",
            "Qwen/Qwen2.5-72B-Instruct",
        ),
        vision_models=frozenset(
            {
                "qwen3-vl-32b-instruct",
                "qwen3-vl-32b-thinking",
                "qwen3-vl-8b-instruct",
                "qwen3-vl-8b-thinking",
                "qwen3-vl-30b-a3b-instruct",
                "qwen3-vl-30b-a3b-thinking",
                "qwen3-vl-235b-a22b-instruct",
                "qwen2-vl-72b-instruct",
                "qwen2.5-vl-72b-instruct",
                "qwen2.5-vl-7b-instruct",
            }
        ),
        suggested_max_input_tokens=120000,
    ),
)

_PROVIDER_BY_ID: dict[LlmProviderId, ProviderProfile] = {
    p.id: p for p in _PROVIDERS
}


def list_providers() -> list[ProviderProfile]:
    return list(_PROVIDERS)


def is_catalog_vision_model(
    provider_id: str | None,
    model_id: str | None,
) -> bool:
    """True when provider catalog explicitly lists the model as vision-capable."""
    if not model_id or not model_id.strip():
        return False
    profile = get_provider(provider_id)
    if profile is None or not profile.vision_models:
        return False
    normalized = normalize_model_id(model_id)
    catalog_norm = {normalize_model_id(item) for item in profile.vision_models}
    return normalized in catalog_norm


def get_provider(provider_id: str | None) -> ProviderProfile | None:
    """
    根据提供商ID获取对应的提供商配置文件
    
    参数:
        provider_id (str | None): 提供商的唯一标识符，如果为None或"custom"则返回None
    
    返回:
        ProviderProfile | None: 对应的提供商配置文件对象，如果找不到则返回None
    """
    if not provider_id or provider_id == "custom":
        return None
    # 从全局提供商映射中根据ID查找对应的提供商配置
    return _PROVIDER_BY_ID.get(provider_id)  # type: ignore[arg-type]


def resolve_provider_id(base_url: str | None) -> LlmProviderId:
    """
    根据基础URL解析并返回对应的LLM提供商标识符
    
    参数:
        base_url (str | None): 基础URL字符串，可能为None或空字符串
    
    返回:
        LlmProviderId: 解析得到的提供商标识符，如果无法匹配则返回"custom"
    """
    # 检查base_url是否为空或仅包含空白字符
    if not base_url or not str(base_url).strip():
        return "custom"
    
    try:
        # 尝试标准化OpenAI基础URL并提取主机名
        normalized = normalize_openai_base_url(base_url)
        host = urlparse(normalized).hostname or ""
    except ValueError:
        # 如果URL格式无效，返回自定义标识符
        return "custom"
    
    # 将主机名转换为小写以进行不区分大小写的比较
    host = host.lower()
    
    # 遍历预定义的提供商配置文件，查找匹配的主机名
    for profile in _PROVIDERS:
        if any(h in host or host.endswith(h) for h in profile.url_hosts):
            return profile.id
    
    # 如果没有找到匹配的提供商，返回自定义标识符
    return "custom"
