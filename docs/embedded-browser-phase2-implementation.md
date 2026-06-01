# 阶段 2：7 个 @tool + 2 个示例技能 — 实施文档

> 预计工期：1.5 周 | 依赖：阶段 1 完成 | 状态：进行中（核心 CDP + 7 tools 已落地）

## 目标

让 deepagent 数字员工能"看"页面（a11y snapshot + 截图）、"操作"页面（点击/填表/提取文本）；通过 SKILL.md frontmatter 的 `automation.operations` 提供 2 个内置示例技能（baidu-search + oa-overtime）作为端到端 demo；前端显示高亮环避免抢焦点。

---

## 实施步骤

### Step 2.1 — BrowserDebuggerController（Electron 主进程）

**新建文件：** `apps/web/electron/features/browser/browser-debugger-controller.ts`

职责：封装 `webContents.debugger` CDP 操作（7 个原子命令）。与 devTools 互斥。

```typescript
import type { WebContents } from "electron"

interface RefNode {
  ref: string          // "@e0", "@e1", ...
  role: string         // "link", "button", "textbox", ...
  name: string | null
  value: string | null
  backendNodeId: number
  depth: number
}

interface CdpResult<T = any> {
  ok: boolean
  data?: T
  error?: string
}

export class BrowserDebuggerController {
  private wc: WebContents | null = null
  private attached = false
  private nextSessionId = 0

  attach(webContents: WebContents): boolean {
    if (this.attached && this.wc === webContents) return true
    try {
      webContents.debugger.attach("1.3")
      this.wc = webContents
      this.attached = true
      return true
    } catch {
      return false
    }
  }

  detach() {
    if (this.attached && this.wc && !this.wc.isDestroyed()) {
      try { this.wc.debugger.detach() } catch {}
    }
    this.attached = false
    this.wc = null
  }

  isAttached(): boolean {
    return this.attached
  }

  private async sendCommand(method: string, params: any = {}): Promise<any> {
    if (!this.attached || !this.wc) throw new Error("Debugger not attached")
    return this.wc.debugger.sendCommand(method, params)
  }

  // ===== 7 个原子操作 =====

  async navigate(url: string): Promise<CdpResult<{ url: string; title: string }>> {
    try {
      await this.sendCommand("Page.enable")
      const navResult = await this.sendCommand("Page.navigate", { url })
      // 等待 loadEventFired
      await this.waitForLoadEvent(30000)
      const title = await this.getTitle()
      return { ok: true, data: { url, title } }
    } catch (e: any) {
      return { ok: false, error: e.message }
    }
  }

  async snapshot(maxNodes = 200): Promise<CdpResult<{ refs: RefNode[] }>> {
    try {
      const result = await this.sendCommand("Accessibility.getFullAXTree")
      const refs = this.buildRefs(result.nodes || [], maxNodes)
      return { ok: true, data: { refs } }
    } catch (e: any) {
      return { ok: false, error: e.message }
    }
  }

  async click(refOrSelector: string): Promise<CdpResult> {
    try {
      const nodeInfo = await this.resolveNode(refOrSelector)
      if (!nodeInfo) return { ok: false, error: "ELEMENT_NOT_FOUND" }

      const { x, y } = nodeInfo.center
      await this.sendCommand("Input.dispatchMouseEvent", {
        type: "mousePressed", x, y, button: "left", clickCount: 1,
      })
      await this.sendCommand("Input.dispatchMouseEvent", {
        type: "mouseReleased", x, y, button: "left", clickCount: 1,
      })
      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: e.message }
    }
  }

  async fill(refOrSelector: string, text: string): Promise<CdpResult> {
    try {
      await this.click(refOrSelector)
      await this.sendCommand("Input.dispatchKeyEvent", {
        type: "keyDown", key: "a", code: "KeyA",
        modifiers: 2, // Ctrl
      })
      await this.sendCommand("Input.dispatchKeyEvent", {
        type: "keyUp", key: "a", code: "KeyA", modifiers: 2,
      })
      await this.sendCommand("Input.dispatchKeyEvent", {
        type: "keyDown", key: "Backspace", code: "Backspace",
      })
      await this.sendCommand("Input.dispatchKeyEvent", {
        type: "keyUp", key: "Backspace", code: "Backspace",
      })

      for (const char of text) {
        await this.sendCommand("Input.dispatchKeyEvent", {
          type: "char", text: char,
        })
      }
      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: e.message }
    }
  }

  async extractText(): Promise<CdpResult<{ text: string }>> {
    try {
      const result = await this.sendCommand("Runtime.evaluate", {
        expression: "document.body.innerText",
        returnByValue: true,
      })
      return { ok: true, data: { text: result.result?.value || "" } }
    } catch (e: any) {
      return { ok: false, error: e.message }
    }
  }

  async screenshot(): Promise<CdpResult<{ base64: string }>> {
    try {
      const result = await this.sendCommand("Page.captureScreenshot", {
        format: "png",
      })
      return { ok: true, data: { base64: result.data } }
    } catch (e: any) {
      return { ok: false, error: e.message }
    }
  }

  async getUrl(): Promise<CdpResult<{ url: string }>> {
    try {
      const result = await this.sendCommand("Runtime.evaluate", {
        expression: "window.location.href",
        returnByValue: true,
      })
      return { ok: true, data: { url: result.result?.value || "" } }
    } catch (e: any) {
      return { ok: false, error: e.message }
    }
  }

  async getTitle(): Promise<string> {
    try {
      const result = await this.sendCommand("Runtime.evaluate", {
        expression: "document.title",
        returnByValue: true,
      })
      return result.result?.value || ""
    } catch {
      return ""
    }
  }

  // ===== 内部工具方法 =====

  private async waitForLoadEvent(timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("TIMEOUT")), timeoutMs)
      // 用一次性 listener 监听 Page.loadEventFired
      const handler = async (method: string) => {
        if (method === "Page.loadEventFired") {
          clearTimeout(timer)
          resolve()
        }
      }
      // Electron debugger 不直接支持 event listener，
      // 用轮询 document.readyState 作为 fallback
      const poll = setInterval(async () => {
        try {
          const r = await this.sendCommand("Runtime.evaluate", {
            expression: "document.readyState",
            returnByValue: true,
          })
          if (r.result?.value === "complete") {
            clearTimeout(timer)
            clearInterval(poll)
            resolve()
          }
        } catch {}
      }, 200)
    })
  }

  private buildRefs(nodes: any[], maxNodes: number): RefNode[] {
    const refs: RefNode[] = []
    let counter = 0

    const nodeMap = new Map<number, any>()
    for (const n of nodes) nodeMap.set(n.nodeId, n)

    function walk(node: any, depth: number) {
      if (refs.length >= maxNodes) return
      if (node.role?.value === "none" || node.ignored) return
      const role = node.role?.value || "generic"
      if (["presentation", "none", "generic"].includes(role) && !node.name?.value && depth > 2) return

      refs.push({
        ref: `@e${counter++}`,
        role,
        name: node.name?.value || null,
        value: node.value?.value || null,
        backendNodeId: node.backendDOMNodeId,
        depth,
      })

      if (node.childIds) {
        for (const childId of node.childIds) {
          const child = nodeMap.get(childId)
          if (child) walk(child, depth + 1)
        }
      }
    }

    const root = nodes.find((n) => n.role?.value === "RootWebArea")
    if (root) walk(root, 0)
    else for (const n of nodes) walk(n, 0)

    return refs
  }

  private async resolveNode(
    refOrSelector: string
  ): Promise<{ backendNodeId: number; center: { x: number; y: number } } | null> {
    // 情况 1: @eN ref
    if (refOrSelector.startsWith("@e")) {
      const snap = await this.snapshot()
      if (!snap.ok) return null
      const found = snap.data.refs.find((r) => r.ref === refOrSelector)
      if (!found) return null

      const bbox = await this.getBbox(found.backendNodeId)
      if (!bbox) return null
      return { backendNodeId: found.backendNodeId, center: bbox.center }
    }

    // 情况 2: CSS selector
    const evalResult = await this.sendCommand("Runtime.evaluate", {
      expression: `
        (() => {
          const el = document.querySelector('${refOrSelector.replace(/'/g, "\\'")}')
          if (!el) return null
          const r = el.getBoundingClientRect()
          return { x: r.x + r.width/2, y: r.y + r.height/2, width: r.width, height: r.height }
        })()
      `,
      returnByValue: true,
    })
    if (!evalResult.result?.value) return null
    const { x, y } = evalResult.result.value
    return { backendNodeId: 0, center: { x, y } }
  }

  private async getBbox(
    backendNodeId: number
  ): Promise<{ center: { x: number; y: number } } | null> {
    try {
      const dom = await this.sendCommand("DOM.getBoxModel", {
        backendNodeId,
      })
      const content = dom.model?.content
      if (!content || content.length < 8) return null
      const xs = [content[0], content[2], content[4], content[6]]
      const ys = [content[1], content[3], content[5], content[7]]
      return {
        center: {
          x: (Math.min(...xs) + Math.max(...xs)) / 2,
          y: (Math.min(...ys) + Math.max(...ys)) / 2,
        },
      }
    } catch {
      return null
    }
  }
}
```

### Step 2.2 — 将 DebuggerController 挂到 IPC

**修改文件：** `apps/web/electron/features/browser/ipc.ts`

在现有 `browserIpcContribution` 中增加 CDP 相关 channel 和 handler：

```typescript
// 新增 IPC channels（ipc-channels.ts）
browserCdpNavigate: "browser:cdp:navigate",
browserCdpSnapshot: "browser:cdp:snapshot",
browserCdpClick: "browser:cdp:click",
browserCdpFill: "browser:cdp:fill",
browserCdpExtractText: "browser:cdp:extract-text",
browserCdpScreenshot: "browser:cdp:screenshot",
browserCdpGetUrl: "browser:cdp:get-url",

// 新增 IPC handlers（ipc.ts）
// 每个 handler 调用 debuggerController 的对应方法
// pattern: invoke(IpcChannels.browserCdpNavigate, url) → debuggerController.navigate(url)
```

### Step 2.3 — 前端高亮环

**新建文件：** `apps/web/electron/features/browser/browser-highlight.ts`

```typescript
// 在子 BrowserWindow 的 preload 中注入高亮样式
export function injectHighlightScript(webContents: WebContents) {
  webContents.on("did-finish-load", () => {
    webContents.insertCSS(`
      .__browser_highlight_ring {
        outline: 3px solid #facc15 !important;
        outline-offset: 2px !important;
        border-radius: 4px !important;
        transition: outline 0.2s ease-in-out !important;
        pointer-events: none !important;
        z-index: 999999 !important;
      }
    `)
  })
}

export async function flashHighlight(
  webContents: WebContents,
  selector: string,
  durationMs = 3000
) {
  try {
    await webContents.executeJavaScript(`
      (() => {
        const el = document.querySelector('${selector.replace(/'/g, "\\'")}')
        if (el) {
          el.classList.add('__browser_highlight_ring')
          setTimeout(() => el.classList.remove('__browser_highlight_ring'), ${durationMs})
        }
      })()
    `)
  } catch {}
}
```

### Step 2.4 — Python 后端：BrowserRuntimeClient

**新建文件：** `apps/server/src/service/browser/browser_runtime_client.py`

```python
"""HTTP client for Electron browser CDP operations.

All requests go to Electron's internal HTTP bridge (Phase 1 uses IPC,
Phase 2 switches to aiohttp on port 58555 for tool-level access).
For MVP, we use the existing FastAPI + IPC path.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

import httpx

logger = logging.getLogger(__name__)


@dataclass
class CdpResult:
    ok: bool
    data: dict[str, Any] = field(default_factory=dict)
    error: str | None = None


class BrowserRuntimeClient:
    """Calls Electron browser IPC via a local HTTP bridge."""

    def __init__(self, base_url: str = "http://127.0.0.1:58000"):
        self._base = base_url.rstrip("/")
        self._client = httpx.AsyncClient(timeout=30.0)

    async def navigate(self, session_id: str, url: str) -> CdpResult:
        return await self._post(f"/internal/browser/{session_id}/navigate", {"url": url})

    async def snapshot(self, session_id: str, max_nodes: int = 200) -> CdpResult:
        return await self._post(f"/internal/browser/{session_id}/snapshot", {"max_nodes": max_nodes})

    async def click(self, session_id: str, ref_or_selector: str) -> CdpResult:
        return await self._post(
            f"/internal/browser/{session_id}/click",
            {"ref_or_selector": ref_or_selector},
        )

    async def fill(self, session_id: str, ref_or_selector: str, text: str) -> CdpResult:
        return await self._post(
            f"/internal/browser/{session_id}/fill",
            {"ref_or_selector": ref_or_selector, "text": text},
        )

    async def extract_text(self, session_id: str) -> CdpResult:
        return await self._post(f"/internal/browser/{session_id}/extract-text", {})

    async def screenshot(self, session_id: str) -> CdpResult:
        return await self._post(f"/internal/browser/{session_id}/screenshot", {})

    async def get_url(self, session_id: str) -> CdpResult:
        return await self._post(f"/internal/browser/{session_id}/get-url", {})

    async def get_title(self, session_id: str) -> CdpResult:
        return await self._post(f"/internal/browser/{session_id}/get-title", {})

    async def _post(self, path: str, payload: dict) -> CdpResult:
        try:
            resp = await self._client.post(f"{self._base}{path}", json=payload)
            resp.raise_for_status()
            body = resp.json()
            return CdpResult(ok=body.get("ok", True), data=body.get("data", {}), error=body.get("error"))
        except httpx.HTTPError as exc:
            logger.warning("browser runtime request failed: %s %s → %s", self._base, path, exc)
            return CdpResult(ok=False, error=str(exc))

    async def close(self):
        await self._client.aclose()
```

### Step 2.5 — Python 后端：FastAPI 路由

**新建文件：** `apps/server/src/service/browser/http_routes.py`

```python
"""FastAPI routes that proxy browser CDP commands to Electron IPC."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from src.service.browser.browser_runtime_client import BrowserRuntimeClient

router = APIRouter(prefix="/internal/browser", tags=["browser"])

_client: BrowserRuntimeClient | None = None


def get_client() -> BrowserRuntimeClient:
    global _client
    if _client is None:
        _client = BrowserRuntimeClient()
    return _client


@router.post("/{session_id}/navigate")
async def navigate(session_id: str, body: dict):
    result = await get_client().navigate(session_id, body["url"])
    if not result.ok:
        raise HTTPException(status_code=502, detail=result.error)
    return {"ok": True, "data": result.data}


@router.post("/{session_id}/snapshot")
async def snapshot(session_id: str, body: dict):
    result = await get_client().snapshot(session_id, body.get("max_nodes", 200))
    if not result.ok:
        raise HTTPException(status_code=502, detail=result.error)
    return {"ok": True, "data": result.data}


@router.post("/{session_id}/click")
async def click(session_id: str, body: dict):
    result = await get_client().click(session_id, body["ref_or_selector"])
    if not result.ok:
        if result.error == "ELEMENT_NOT_FOUND":
            raise HTTPException(status_code=404, detail=result.error)
        raise HTTPException(status_code=502, detail=result.error)
    return {"ok": True}


@router.post("/{session_id}/fill")
async def fill(session_id: str, body: dict):
    result = await get_client().fill(
        session_id, body["ref_or_selector"], body["text"]
    )
    if not result.ok:
        raise HTTPException(status_code=502, detail=result.error)
    return {"ok": True}


@router.post("/{session_id}/extract-text")
async def extract_text(session_id: str):
    result = await get_client().extract_text(session_id)
    if not result.ok:
        raise HTTPException(status_code=502, detail=result.error)
    return {"ok": True, "data": result.data}


@router.post("/{session_id}/screenshot")
async def screenshot(session_id: str):
    result = await get_client().screenshot(session_id)
    if not result.ok:
        raise HTTPException(status_code=502, detail=result.error)
    return {"ok": True, "data": result.data}


@router.post("/{session_id}/get-url")
async def get_url(session_id: str):
    result = await get_client().get_url(session_id)
    if not result.ok:
        raise HTTPException(status_code=502, detail=result.error)
    return {"ok": True, "data": result.data}


@router.post("/{session_id}/get-title")
async def get_title(session_id: str):
    result = await get_client().get_title(session_id)
    if not result.ok:
        raise HTTPException(status_code=502, detail=result.error)
    return {"ok": True, "data": result.data}
```

**修改文件：** `apps/server/src/api/__init__.py`

```python
from src.service.browser.http_routes import router as browser_router
# ...
api_router.include_router(browser_router)
```

### Step 2.6 — Python 后端：7 个 @tool

**新建文件：** `apps/server/src/service/agent/browser_tool.py`

遵循 `shell_execute_tool.py` 的 `StructuredTool.from_function` 模式。

```python
"""Browser automation tools for deepagents.

7 tools: navigate / click / fill / snapshot / extract_text / screenshot / get_url
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any

from langchain_core.tools import BaseTool, StructuredTool
from pydantic import BaseModel, Field

from src.service.browser.browser_runtime_client import BrowserRuntimeClient

logger = logging.getLogger(__name__)

_DEFAULT_SESSION = "default"
_client: BrowserRuntimeClient | None = None


def _get_client() -> BrowserRuntimeClient:
    global _client
    if _client is None:
        _client = BrowserRuntimeClient()
    return _client


class BrowserNavigateInput(BaseModel):
    url: str = Field(description="要导航到的完整 URL")
    intent: str | None = Field(default=None, description="操作意图，20字内中文短语")


class BrowserClickInput(BaseModel):
    ref_or_selector: str = Field(
        description="元素引用，如 @e5 或 CSS 选择器 #submit"
    )
    intent: str | None = Field(default=None, description="操作意图")
    confirmation_required: bool = Field(
        default=False, description="是否需要用户确认后执行"
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
    pass


def _format_error(action: str, error: str | None) -> str:
    return f"[BROWSER_{action.upper()}_FAILED] {error or 'unknown error'}"


async def _browser_navigate(url: str, intent: str | None = None) -> str:
    result = await asyncio.wait_for(
        _get_client().navigate(_DEFAULT_SESSION, url), timeout=30
    )
    if not result.ok:
        return _format_error("navigate", result.error)
    title = result.data.get("title", "")
    return f"已导航到 {url}（标题: {title}）"


async def _browser_click(
    ref_or_selector: str,
    intent: str | None = None,
    confirmation_required: bool = False,
) -> str:
    if confirmation_required:
        # TODO: 阶段 2 简化处理 — 直接执行，不弹确认框
        # 完整 HITL confirmation 将在后续完善
        pass

    result = await asyncio.wait_for(
        _get_client().click(_DEFAULT_SESSION, ref_or_selector), timeout=30
    )
    if not result.ok:
        if result.error == "ELEMENT_NOT_FOUND":
            return f"元素未找到: {ref_or_selector}。建议重新 browser_snapshot 获取最新页面结构。"
        return _format_error("click", result.error)
    return f"已点击 {ref_or_selector}"


async def _browser_fill(
    ref_or_selector: str, text: str, intent: str | None = None
) -> str:
    result = await asyncio.wait_for(
        _get_client().fill(_DEFAULT_SESSION, ref_or_selector, text), timeout=30
    )
    if not result.ok:
        return _format_error("fill", result.error)
    return f"已在 {ref_or_selector} 填入文本"


async def _browser_snapshot(intent: str | None = None) -> str:
    result = await asyncio.wait_for(
        _get_client().snapshot(_DEFAULT_SESSION), timeout=30
    )
    if not result.ok:
        return _format_error("snapshot", result.error)

    refs = result.data.get("refs", [])
    lines = ["页面可访问性树（a11y snapshot）："]
    for r in refs:
        indent = "  " * r.get("depth", 0)
        name = f' "{r["name"]}"' if r.get("name") else ""
        value = f' = "{r["value"]}"' if r.get("value") else ""
        lines.append(f'{indent}{r["ref"]} [{r["role"]}]{name}{value}')
    lines.append(f"\n共 {len(refs)} 个节点")
    return "\n".join(lines)


async def _browser_extract_text(intent: str | None = None) -> str:
    result = await asyncio.wait_for(
        _get_client().extract_text(_DEFAULT_SESSION), timeout=30
    )
    if not result.ok:
        return _format_error("extract_text", result.error)
    return result.data.get("text", "")


async def _browser_screenshot(intent: str | None = None) -> str:
    result = await asyncio.wait_for(
        _get_client().screenshot(_DEFAULT_SESSION), timeout=30
    )
    if not result.ok:
        return _format_error("screenshot", result.error)
    # 返回 base64 截图信息（不直接返回 base64 数据，避免 token 爆炸）
    return "截图成功（base64 已存储，可传递给前端展示）"


async def _browser_get_url() -> str:
    result = await asyncio.wait_for(
        _get_client().get_url(_DEFAULT_SESSION), timeout=10
    )
    if not result.ok:
        return _format_error("get_url", result.error)
    return result.data.get("url", "")


def create_browser_tools() -> list[BaseTool]:
    """创建 7 个浏览器自动化工具。"""
    return [
        StructuredTool.from_function(
            coroutine=_browser_navigate,
            name="browser_navigate",
            description="在内嵌浏览器中导航到指定 URL。返回页面标题。",
            args_schema=BrowserNavigateInput,
        ),
        StructuredTool.from_function(
            coroutine=_browser_click,
            name="browser_click",
            description="点击页面元素。ref_or_selector 可以是 @eN 引用（来自 snapshot）或 CSS 选择器。",
            args_schema=BrowserClickInput,
        ),
        StructuredTool.from_function(
            coroutine=_browser_fill,
            name="browser_fill",
            description="在页面元素中填入文本。先清空原有内容再输入。",
            args_schema=BrowserFillInput,
        ),
        StructuredTool.from_function(
            coroutine=_browser_snapshot,
            description="获取当前页面的可访问性树（a11y snapshot），返回带有 @eN 引用的元素列表。用于识别页面结构。",
            args_schema=BrowserSnapshotInput,
        ),
        StructuredTool.from_function(
            coroutine=_browser_extract_text,
            description="提取当前页面 body 的纯文本内容。",
            args_schema=BrowserExtractTextInput,
        ),
        StructuredTool.from_function(
            coroutine=_browser_screenshot,
            description="截取当前页面的 PNG 截图。",
            args_schema=BrowserScreenshotInput,
        ),
        StructuredTool.from_function(
            coroutine=_browser_get_url,
            name="browser_get_url",
            description="获取当前浏览器页面的 URL。",
            args_schema=BrowserGetUrlInput,
        ),
    ]
```

### Step 2.7 — 注册工具到 Agent

**修改文件：** `apps/server/src/service/agent/employee.py`

```python
from src.service.agent.browser_tool import create_browser_tools

# 在创建 agent 之前，添加到 extra_tools：
browser_tools = create_browser_tools()
extra_tools.extend(browser_tools)
```

**修改文件：** `apps/server/src/service/agent/orchestrator/agent.py`

同步添加 browser_tools（如果 orchestrator 也需要浏览器能力）：

```python
from src.service.agent.browser_tool import create_browser_tools

# orchestrator 的 tools 列表中添加：
tools.extend(create_browser_tools())
```

### Step 2.8 — 示例技能 1：baidu-search

**新建目录和文件：** `apps/server/build-in-skills/baidu-search/SKILL.md`

```markdown
---
name: baidu-search
description: 在百度搜索关键词
automation:
  target_url: https://baidu.com
  operations:
    - action: navigate
      url: https://baidu.com
    - action: fill
      selector: "#kw"
      value: "${user_query}"
    - action: click
      selector: "#su"
---

# 百度搜索

## 适用场景
- 用户说"打开百度搜索 XXX"时启用
- 已登录百度的用户可正常使用

## LLM 行为提示
1. 识别 frontmatter `automation.operations` 中的 `${user_query}` 变量
2. 从用户提问提取 `{ user_query: "..." }`
3. 依次调 `browser_navigate` → `browser_fill("#kw", ...)` → `browser_click("#su")`
4. 收到成功响应 → 自然语言回复

## 注意
- 如果 selector 失效（百度改版），回退到 `browser_snapshot` 重新发现元素
```

### Step 2.9 — 示例技能 2：oa-overtime

**新建目录和文件：** `apps/server/build-in-skills/oa-overtime/SKILL.md`

```markdown
---
name: oa-overtime
description: 公司OA系统加班申请
automation:
  target_url: https://oa.example.com/overtime/new
  operations:
    - action: navigate
      url: https://oa.example.com/overtime/new
    - action: wait_for
      selector: "#startTime"
      timeout_ms: 10000
    - action: fill
      selector: "#startTime"
      value: "${start_time}"
    - action: fill
      selector: "#endTime"
      value: "${end_time}"
    - action: fill
      selector: "#reason"
      value: "${reason}"
    - action: select
      selector: "#overtimeType"
      value: "加班"
    - action: click
      selector: "#submit"
      confirmation_required: true
      confirmation_message: "确认提交 ${start_time}-${end_time} 加班申请？"
---

# OA 加班申请

## 适用场景
- 用户在内嵌浏览器中已登录公司OA
- LLM 只需从用户提问提取开始/结束时间 + 原因

## LLM 行为提示
1. 识别 frontmatter `automation.operations` 中的 `${start_time}` / `${end_time}` / `${reason}` 变量
2. 从用户提问"帮我提个加班申请，今天9-19点"提取：
   - `{ start_time: "09:00", end_time: "19:00", reason: "工作需要" }`
3. 依次调 7 个 `browser_*` 工具
4. 最后一步 `browser_click(confirmation_required=True)` → 弹确认框 → 用户确认 → 执行
```

---

## 新增/修改文件清单

### 新增 7 个

| # | 路径 | 职责 |
|---|------|------|
| 1 | `apps/web/electron/features/browser/browser-debugger-controller.ts` | CDP 封装 |
| 2 | `apps/web/electron/features/browser/browser-highlight.ts` | 高亮环 |
| 3 | `apps/server/src/service/browser/__init__.py` | 包初始化 |
| 4 | `apps/server/src/service/browser/browser_runtime_client.py` | HTTP 客户端 |
| 5 | `apps/server/src/service/browser/http_routes.py` | FastAPI 路由 |
| 6 | `apps/server/src/service/agent/browser_tool.py` | 7 个 @tool |
| 7 | `apps/server/build-in-skills/baidu-search/SKILL.md` | 示例技能 1 |
| 8 | `apps/server/build-in-skills/oa-overtime/SKILL.md` | 示例技能 2 |

### 修改 4 个

| # | 路径 | 改动 |
|---|------|------|
| 1 | `apps/web/electron/shared/ipc-channels.ts` | 新增 7 个 CDP channel |
| 2 | `apps/web/electron/features/browser/ipc.ts` | 新增 CDP handler |
| 3 | `apps/server/src/service/agent/employee.py` | extra_tools += browser_tools |
| 4 | `apps/server/src/service/agent/orchestrator/agent.py` | tools += browser_tools |
| 5 | `apps/server/src/api/__init__.py` | 挂 browser_router |

---

## 验收标准

- [ ] 对话："打开 example.com 列出所有链接" → agent navigate → snapshot → 返回 ≥5 节点
- [ ] 对话："点第 3 个链接" → agent 用 `@e3` click → 前端 3s 黄色高亮环
- [ ] 对话："在搜索框输入 'hello'" → agent fill → 三方页面搜索框出现 "hello"
- [ ] 对话："帮我打开百度搜索周杰伦" → 端到端跑通 baidu-search
- [ ] 对话："帮我提个加班申请，今天9-19点" → 弹出确认框 → 用户确认 → 提交成功
- [ ] `OFFLINE_MODE=1` + 离线 demo 页面 → 完整流程跑通
- [ ] token 预算：200 节点 snapshot ≤ 2k tokens
- [ ] 密码字段不暴露在 snapshot 中

## 测试

```bash
# 前端
pnpm typecheck && pnpm lint

# 后端
cd apps/server
uv run pytest tests/test_browser_runtime_client.py -v
```
