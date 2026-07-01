"""OpenAI-compatible prompt caching helpers (Qwen/DashScope explicit, OpenAI key hint).

DashScope (Qwen, 百炼 DeepSeek 等) 在 Chat Completions 里用 content block 上的
``cache_control: {"type": "ephemeral"}`` 做显式缓存；``prompt_cache_key`` 会被忽略。

DeepSeek 官方 API 为全自动前缀缓存，无需也不应注入 ``cache_control``。

本地 llama.cpp 等自建端点关闭注入，继续靠 ``--slot-prompt-similarity`` 前缀匹配。

其它公网 OpenAI 兼容端点（custom / One-API / vLLM 网关 / 硅基流动等）默认 ``auto``：
只附加 ``prompt_cache_key``、不改 messages 结构；不支持的厂商会静默忽略该字段，
仍可能靠服务端自动前缀匹配受益——前提是 system 前缀稳定。
若确认厂商支持 DashScope 式 ``cache_control`` 块，可在系统配置
``config_kvs.PROMPT_CACHE_MODE``（设置 → 模型 → 高级选项）设为 ``explicit``。
环境变量 ``PROMPT_CACHE_MODE`` / ``PROMPT_CACHE_ENABLED`` 仍可覆盖（部署用）。
"""

from __future__ import annotations

import hashlib
import os
import re
from typing import Any, Literal
from urllib.parse import urlparse

from src.llm.providers import resolve_provider_id

PromptCacheStrategy = Literal["off", "auto", "explicit"]

_CACHE_CONTROL_EPHEMERAL: dict[str, str] = {"type": "ephemeral"}

_LOCAL_HOSTS = frozenset({"localhost", "127.0.0.1", "0.0.0.0", "::1"})
_LLAMA_CPP_PATH_HINTS = ("/v1", "/completion", "llama")


def _env_bool(name: str) -> bool | None:
    raw = os.getenv(name, "").strip().lower()
    if not raw:
        return None
    if raw in ("1", "true", "yes", "on"):
        return True
    if raw in ("0", "false", "no", "off"):
        return False
    return None


def _env_mode() -> PromptCacheStrategy | None:
    raw = os.getenv("PROMPT_CACHE_MODE", "").strip().lower()
    if raw in ("off", "auto", "explicit"):
        return raw  # type: ignore[return-value]
    return None


def is_local_llm_base_url(base_url: str | None) -> bool:
    """Heuristic: localhost / private LAN endpoints should not get cloud cache markers."""
    if not base_url or not str(base_url).strip():
        return False
    try:
        parsed = urlparse(str(base_url).strip())
    except ValueError:
        return False
    host = (parsed.hostname or "").lower()
    if host in _LOCAL_HOSTS:
        return True
    if host.startswith("192.168.") or host.startswith("10."):
        return True
    if host.startswith("172."):
        parts = host.split(".")
        if len(parts) >= 2:
            try:
                second = int(parts[1])
                if 16 <= second <= 31:
                    return True
            except ValueError:
                pass
    path = (parsed.path or "").lower()
    if any(h in path for h in _LLAMA_CPP_PATH_HINTS) and host in _LOCAL_HOSTS:
        return True
    return False


def resolve_prompt_cache_strategy(
    *,
    base_url: str | None,
    provider_id: str | None,
    config_mode: str | None = None,
) -> PromptCacheStrategy:
    """Pick caching injection strategy for the active LLM endpoint.

    Priority: env PROMPT_CACHE_MODE > env PROMPT_CACHE_ENABLED=false > config_kvs
    PROMPT_CACHE_MODE > provider/base_url heuristics.
    """
    mode_override = _env_mode()
    if mode_override == "off":
        return "off"

    enabled_override = _env_bool("PROMPT_CACHE_ENABLED")
    if enabled_override is False:
        return "off"

    if mode_override in ("explicit", "auto"):
        return mode_override

    config_normalized = (config_mode or "").strip().lower()
    if config_normalized == "off":
        return "off"
    if config_normalized == "explicit":
        return "explicit"
    if config_normalized == "auto":
        return "auto"

    if enabled_override is True and not config_normalized:
        return "auto"

    if is_local_llm_base_url(base_url):
        return "off"

    resolved_provider = (provider_id or "").strip() or resolve_provider_id(base_url)
    if resolved_provider == "dashscope":
        return "explicit"
    if resolved_provider in ("openai", "deepseek"):
        return "auto"

    if resolved_provider in ("moonshot", "zhipu", "siliconflow", "custom"):
        return "auto"

    return "off"


def _extract_text_from_content(content: Any) -> str:
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict):
                text = block.get("text")
                if isinstance(text, str):
                    parts.append(text)
        return "".join(parts)
    return str(content)


def _system_message_text(messages: list[dict[str, Any]]) -> str:
    chunks: list[str] = []
    for msg in messages:
        if msg.get("role") != "system":
            break
        chunks.append(_extract_text_from_content(msg.get("content")))
    return "".join(chunks)


# Anthropic/DashScope/vLLM 显式缓存的断点上限通常为 4。
_MAX_CACHE_BREAKPOINTS = 4


def apply_explicit_cache_markers(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """system_and_3 策略：缓存 system 前缀 + 摘要块 + 尾部最近若干条消息。

    旧实现只打 system + 摘要两个断点：稳定前缀能命中，但每轮新增的 user/assistant/
    tool 历史没有断点，断点之后的增量历史无法被缓存复用，多轮长对话每轮都为整段
    历史重新计费。对齐 hermes-agent 的 system_and_3：再给最后几条非 system 消息
    打断点，让滚动增长的历史也能命中（实测 GPUStack：第二轮 cached_tokens 命中、
    TTFT 降 ~3x）。断点总数封顶 _MAX_CACHE_BREAKPOINTS（厂商硬限）。
    """
    if not messages:
        return messages

    marked_indices: set[int] = set()
    out: list[dict[str, Any]] = list(messages)

    # 1) system 前缀（首条 system）
    for idx, msg in enumerate(out):
        if msg.get("role") == "system":
            out[idx] = mark_system_message_cache_control(msg)
            marked_indices.add(idx)
            break

    # 2) 摘要块（稳定的滚动摘要前缀，若有）
    for idx, msg in enumerate(out):
        if idx in marked_indices:
            continue
        if msg.get("role") in ("user", "human") and is_summarization_message(msg):
            out[idx] = mark_message_cache_control(msg)
            marked_indices.add(idx)
            break

    # 3) 尾部最近的非 system 消息，补满到上限
    remaining = _MAX_CACHE_BREAKPOINTS - len(marked_indices)
    if remaining > 0:
        non_system = [
            i for i, m in enumerate(out) if m.get("role") != "system"
        ]
        for idx in non_system[-remaining:]:
            if idx in marked_indices:
                continue
            out[idx] = mark_message_cache_control(out[idx])
            marked_indices.add(idx)

    return out


def _message_additional_kwargs(message: dict[str, Any]) -> dict[str, Any]:
    extra = message.get("additional_kwargs")
    if isinstance(extra, dict):
        return extra
    return {}


def is_summarization_message(message: dict[str, Any]) -> bool:
    """True when a payload message is a rolled-up conversation summary."""
    if _message_additional_kwargs(message).get("lc_source") == "summarization":
        return True
    return message.get("lc_source") == "summarization"


def extract_summary_fingerprint(messages: list[dict[str, Any]]) -> str | None:
    """Hash of the active summary block — included in prompt_cache_key after compression."""
    for message in messages:
        if message.get("role") not in ("user", "human"):
            continue
        if not is_summarization_message(message):
            continue
        text = _extract_text_from_content(message.get("content")).strip()
        if not text:
            continue
        return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]
    return None


def mark_message_cache_control(message: dict[str, Any]) -> dict[str, Any]:
    """Attach ephemeral cache marker to the last text block of a message."""
    out = dict(message)
    content = out.get("content")
    if content is None:
        return out

    if isinstance(content, str):
        if not content.strip():
            return out
        out["content"] = [
            {
                "type": "text",
                "text": content,
                "cache_control": dict(_CACHE_CONTROL_EPHEMERAL),
            }
        ]
        return out

    if isinstance(content, list):
        blocks = [dict(b) if isinstance(b, dict) else b for b in content]
        for idx in range(len(blocks) - 1, -1, -1):
            block = blocks[idx]
            if not isinstance(block, dict):
                continue
            if block.get("type") not in (None, "text"):
                continue
            text = block.get("text")
            if isinstance(text, str) and text.strip():
                marked = dict(block)
                marked.setdefault("type", "text")
                marked["cache_control"] = dict(_CACHE_CONTROL_EPHEMERAL)
                blocks[idx] = marked
                out["content"] = blocks
                return out
    return out


def mark_system_message_cache_control(message: dict[str, Any]) -> dict[str, Any]:
    """Attach DashScope/Anthropic-style ephemeral cache marker to one system message."""
    return mark_message_cache_control(message)


def compute_prompt_cache_key(
    system_prefix: str,
    *,
    compression_fingerprint: str | None = None,
) -> str | None:
    """Stable routing hint for OpenAI automatic prompt caching."""
    normalized = system_prefix.strip()
    if compression_fingerprint:
        normalized = f"{normalized}\0summary:{compression_fingerprint}"
    if len(normalized) < 64:
        return None
    digest = hashlib.sha256(normalized.encode("utf-8")).hexdigest()
    return f"boban-{digest[:24]}"


def apply_prompt_cache_to_payload(
    payload: dict[str, Any],
    strategy: PromptCacheStrategy,
) -> dict[str, Any]:
    """Mutate chat-completions payload in place according to strategy."""
    if strategy == "off":
        return payload

    messages = payload.get("messages")
    if not isinstance(messages, list):
        return payload

    if strategy == "explicit":
        payload["messages"] = apply_explicit_cache_markers(messages)
        return payload

    # auto: OpenAI prompt_cache_key; DeepSeek/others rely on automatic prefix cache.
    provider_hint = (payload.get("model") or "").lower()
    system_text = _system_message_text(messages)
    summary_fp = extract_summary_fingerprint(messages)
    cache_key = compute_prompt_cache_key(
        system_text,
        compression_fingerprint=summary_fp,
    )
    if cache_key and not re.search(r"deepseek", provider_hint):
        payload.setdefault("prompt_cache_key", cache_key)
    return payload
