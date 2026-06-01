"""Browser automation tools for deepagents (7 tools)."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from langchain_core.tools import BaseTool, StructuredTool
from pydantic import BaseModel, Field

from src.service.browser.browser_runtime_client import (
    BrowserRuntimeClient,
    default_session_id,
)

logger = logging.getLogger(__name__)

_client: BrowserRuntimeClient | None = None


def _get_client() -> BrowserRuntimeClient:
    global _client
    if _client is None:
        _client = BrowserRuntimeClient()
    return _client


def _session() -> str:
    return default_session_id()


def _format_error(action: str, error: str | None) -> str:
    return f"[BROWSER_{action.upper()}_FAILED] {error or 'unknown error'}"


class BrowserNavigateInput(BaseModel):
    url: str = Field(description="要导航到的完整 URL")
    intent: str | None = Field(
        default=None, description="操作意图，20字内中文短语"
    )


class BrowserClickInput(BaseModel):
    ref_or_selector: str = Field(
        description="元素引用 @eN（来自 snapshot）或 CSS 选择器"
    )
    intent: str | None = Field(default=None, description="操作意图")
    confirmation_required: bool = Field(
        default=False, description="是否需要用户确认后执行"
    )
    confirmation_message: str | None = Field(
        default=None, description="确认框展示文案（confirmation_required 时建议填写）"
    )


class BrowserFillInput(BaseModel):
    ref_or_selector: str = Field(description="元素引用或 CSS 选择器")
    text: str = Field(description="要填入的文本")
    intent: str | None = Field(default=None, description="操作意图")


class BrowserSnapshotInput(BaseModel):
    intent: str | None = Field(default=None, description="操作意图")


class BrowserExtractTextInput(BaseModel):
    intent: str | None = Field(default=None, description="操作意图")


class BrowserScreenshotInput(BaseModel):
    intent: str | None = Field(default=None, description="操作意图")


class BrowserGetUrlInput(BaseModel):
    intent: str | None = Field(default=None, description="操作意图")


async def _browser_navigate(url: str, intent: str | None = None) -> str:
    del intent
    result = await asyncio.wait_for(
        _get_client().navigate(_session(), url),
        timeout=30,
    )
    if not result.ok:
        return _format_error("navigate", result.error)
    title = result.data.get("title", "")
    return f"已导航到 {url}（标题: {title}）"


async def _browser_click(
    ref_or_selector: str,
    intent: str | None = None,
    confirmation_required: bool = False,
    confirmation_message: str | None = None,
) -> str:
    del intent
    msg = confirmation_message
    if confirmation_required and not msg:
        msg = f"确认点击「{ref_or_selector}」？"
    result = await asyncio.wait_for(
        _get_client().click(
            _session(),
            ref_or_selector,
            confirmation_required=confirmation_required,
            confirmation_message=msg,
        ),
        timeout=120 if confirmation_required else 30,
    )
    if not result.ok:
        if result.error == "USER_CANCELLED":
            return "用户已取消该浏览器操作"
        if result.error == "ELEMENT_NOT_FOUND":
            return (
                f"元素未找到: {ref_or_selector}。"
                "建议重新 browser_snapshot 获取最新页面结构。"
            )
        return _format_error("click", result.error)
    return f"已点击 {ref_or_selector}"


async def _browser_fill(
    ref_or_selector: str, text: str, intent: str | None = None
) -> str:
    del intent
    result = await asyncio.wait_for(
        _get_client().fill(_session(), ref_or_selector, text),
        timeout=30,
    )
    if not result.ok:
        if result.error == "ELEMENT_NOT_FOUND":
            return f"元素未找到: {ref_or_selector}"
        return _format_error("fill", result.error)
    return f"已在 {ref_or_selector} 填入文本"


async def _browser_snapshot(intent: str | None = None) -> str:
    del intent
    result = await asyncio.wait_for(
        _get_client().snapshot(_session()),
        timeout=30,
    )
    if not result.ok:
        return _format_error("snapshot", result.error)

    refs: list[dict[str, Any]] = result.data.get("refs", [])
    lines = ["页面可访问性树（a11y snapshot）："]
    for r in refs:
        indent = "  " * int(r.get("depth", 0))
        name = f' "{r["name"]}"' if r.get("name") else ""
        value = f' = "{r["value"]}"' if r.get("value") else ""
        lines.append(
            f'{indent}{r.get("ref", "?")} [{r.get("role", "?")}]{name}{value}'
        )
    lines.append(f"\n共 {len(refs)} 个节点")
    return "\n".join(lines)


async def _browser_extract_text(intent: str | None = None) -> str:
    del intent
    result = await asyncio.wait_for(
        _get_client().extract_text(_session()),
        timeout=30,
    )
    if not result.ok:
        return _format_error("extract_text", result.error)
    return str(result.data.get("text", ""))


async def _browser_screenshot(intent: str | None = None) -> str:
    del intent
    result = await asyncio.wait_for(
        _get_client().screenshot(_session()),
        timeout=30,
    )
    if not result.ok:
        return _format_error("screenshot", result.error)
    b64 = result.data.get("base64", "")
    size_kb = len(b64) * 3 // 4 // 1024 if b64 else 0
    return f"截图成功（约 {size_kb} KB PNG，base64 已生成）"


async def _browser_get_url(intent: str | None = None) -> str:
    del intent
    result = await asyncio.wait_for(
        _get_client().get_url(_session()),
        timeout=10,
    )
    if not result.ok:
        return _format_error("get_url", result.error)
    return str(result.data.get("url", ""))


def create_browser_tools() -> list[BaseTool]:
    """创建 7 个浏览器自动化工具。"""
    return [
        StructuredTool.from_function(
            coroutine=_browser_navigate,
            name="browser_navigate",
            description="在内嵌浏览器中导航到指定 URL。需桌面端 Electron 且浏览器面板可用。",
            args_schema=BrowserNavigateInput,
        ),
        StructuredTool.from_function(
            coroutine=_browser_click,
            name="browser_click",
            description=(
                "点击页面元素。ref_or_selector 可以是 @eN（snapshot）或 CSS 选择器。"
            ),
            args_schema=BrowserClickInput,
        ),
        StructuredTool.from_function(
            coroutine=_browser_fill,
            name="browser_fill",
            description="在可编辑元素中填入文本（先聚焦再输入）。",
            args_schema=BrowserFillInput,
        ),
        StructuredTool.from_function(
            coroutine=_browser_snapshot,
            name="browser_snapshot",
            description=(
                "获取当前页面 a11y 树（≤200 节点），返回 @eN 引用列表。"
            ),
            args_schema=BrowserSnapshotInput,
        ),
        StructuredTool.from_function(
            coroutine=_browser_extract_text,
            name="browser_extract_text",
            description="提取当前页面 body 纯文本。",
            args_schema=BrowserExtractTextInput,
        ),
        StructuredTool.from_function(
            coroutine=_browser_screenshot,
            name="browser_screenshot",
            description="截取当前页面 PNG 截图。",
            args_schema=BrowserScreenshotInput,
        ),
        StructuredTool.from_function(
            coroutine=_browser_get_url,
            name="browser_get_url",
            description="获取内嵌浏览器当前 URL。",
            args_schema=BrowserGetUrlInput,
        ),
    ]
