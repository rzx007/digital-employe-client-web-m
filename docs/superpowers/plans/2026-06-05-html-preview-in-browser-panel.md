# 对话 HTML 在 browser-panel 打开（经后端静态资源服务）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 点击对话产生的 HTML 文件卡片时，在 browser-panel（内嵌浏览器 WebContentsView）中打开该 HTML，支持相对资源依赖，并让 browser-runtime/browserctl 能对其自然语言交互。

**Architecture:** 三处职责隔离 ——（1）后端新增 path-based、inline 的静态资源端点，复用现有文件定位与安全校验；（2）前端 browser-store 新增 `openHtmlPreview`，把对话 HTML 拼成后端静态 URL 后走现有 `openBrowser` 流程，零特化 browser-panel；（3）FileChangeCard 对 `.html/.htm` 分流到 `openHtmlPreview`。browser-panel 保持"打开任意 http 站点"的本意，HTML 预览只是它打开的又一个普通 URL；browserctl 操作"当前页"，自动可用。**后端 resources 端点无强制 token auth，故无需 Electron 凭证注入。**

**Tech Stack:** FastAPI（后端，pytest）、React + Zustand（前端，vitest）、Electron WebContentsView（复用现有 browser-panel）。

---

## File Structure

**后端**
- Modify `apps/server/src/api/chat_api.py`：在 `download` 端点（约 434 行）旁新增 `GET /chat/conversations/{id}/resources/static/{path:path}`（path-based、inline、mime by ext）。
- Test `apps/server/tests/test_resource_static.py`：FastAPI TestClient 测 inline/mime/相对资源/404/路径穿越拒绝。
- （不改 `resource_service.py`——复用现有 `ResourceService.resolve_download_path`。）

**前端**
- Modify `apps/web/src/stores/browser-store.ts`：新增 `openHtmlPreview(conversationId, virtualPath)`。
- Modify `apps/web/src/components/chat/message-blocks/file-change-cards.tsx`：`.html/.htm` 分流。
- Test `apps/web/src/stores/browser-store.test.ts`：URL 构造 + 复用 openBrowser。
- Test `apps/web/src/components/chat/message-blocks/file-change-cards.routing.test.ts`：分流逻辑（如组件难测，则把分流逻辑抽成纯函数 `resolveFileOpen` 单测）。

**关键约束**
- 后端 `FileResponse` **不传 `filename`** → 不加 `Content-Disposition: attachment` → 浏览器 inline 渲染（传 filename 会触发下载，HTML 不会渲染）。
- URL 必须 **path-based**（`/resources/static/artifacts/x.html`），不能 query-based（`?path=`），否则相对资源 `./style.css` 解析丢失参数。

---

## Task 1: 后端静态资源端点

**Files:**
- Modify: `apps/server/src/api/chat_api.py`（在 `download_conversation_resource` 后新增）
- Test: `apps/server/tests/test_resource_static.py`

- [ ] **Step 1: 写失败测试**

```python
# apps/server/tests/test_resource_static.py
from pathlib import Path
import pytest
from fastapi.testclient import TestClient

from src.server import app
from src.core.config import get_settings


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def conv_artifacts(tmp_path, monkeypatch):
    """构造一个会话产物目录：<root>/<conv_id>/artifacts/{report.html, style.css}"""
    settings = get_settings()
    monkeypatch.setattr(settings, "artifacts_path", str(tmp_path), raising=False)
    conv_id = 999999
    art = tmp_path / str(conv_id) / "artifacts"
    art.mkdir(parents=True)
    (art / "report.html").write_text(
        '<html><head><link rel="stylesheet" href="./style.css"></head>'
        '<body><h1>Hi</h1></body></html>',
        encoding="utf-8",
    )
    (art / "style.css").write_text("h1{color:red}", encoding="utf-8")
    # ChatService.get_conversation 需要能拿到该会话；按本仓 conftest/已有 fixture 方式
    # 注入一个 id=conv_id 的会话（参考 tests 中现有创建会话的辅助）。
    return conv_id


def test_static_serves_html_inline_with_mime(client, conv_artifacts):
    r = client.get(
        f"/chat/conversations/{conv_artifacts}/resources/static/artifacts/report.html"
    )
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/html")
    # 关键：inline，不是 attachment（否则浏览器下载而非渲染）
    assert "attachment" not in r.headers.get("content-disposition", "")
    assert "<h1>Hi</h1>" in r.text


def test_static_serves_relative_asset(client, conv_artifacts):
    r = client.get(
        f"/chat/conversations/{conv_artifacts}/resources/static/artifacts/style.css"
    )
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/css")
    assert "color:red" in r.text


def test_static_rejects_path_traversal(client, conv_artifacts):
    r = client.get(
        f"/chat/conversations/{conv_artifacts}/resources/static/artifacts/../../secret"
    )
    assert r.status_code in (400, 404)


def test_static_404_for_missing(client, conv_artifacts):
    r = client.get(
        f"/chat/conversations/{conv_artifacts}/resources/static/artifacts/nope.html"
    )
    assert r.status_code == 404
```

> 注：会话注入方式按 `apps/server/tests` 现有约定（查 conftest.py 是否有创建 conversation 的 fixture；若有则复用，没有则在 fixture 内用 ChatService/DB 直接插一条）。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/server && uv run pytest tests/test_resource_static.py -v`
Expected: FAIL（端点不存在 → 404 / 路由未注册）

- [ ] **Step 3: 实现端点**

在 `apps/server/src/api/chat_api.py` 顶部确认已 `import mimetypes`（无则加），并在 `download_conversation_resource` 后新增：

```python
@router.get("/chat/conversations/{conversation_id}/resources/static/{path:path}")
def serve_conversation_resource_static(
    conversation_id: int,
    path: str,
    db: Session = Depends(get_db),
):
    """以 inline + 正确 Content-Type 提供会话产物文件，path-based 支持相对资源。
    复用 download 的定位与路径穿越安全校验；仅服务单个文件（目录返回 404）。"""
    conversation = ChatService.get_conversation(db, conversation_id)
    settings = get_settings()
    virtual_path = "/" + path.lstrip("/")  # "artifacts/x.html" -> "/artifacts/x.html"
    result = ResourceService.resolve_download_path(
        settings.artifacts_path, conversation.id, virtual_path
    )
    if result is None:
        raise HTTPException(status_code=404, detail="not found")
    resolved, is_dir = result
    if is_dir:
        raise HTTPException(status_code=404, detail="not a file")
    media_type, _ = mimetypes.guess_type(resolved.name)
    # 关键：不传 filename → 无 Content-Disposition attachment → 浏览器 inline 渲染
    return FileResponse(resolved, media_type=media_type or "application/octet-stream")
```

确认文件已 `from fastapi import HTTPException`（或 `from fastapi import ... HTTPException`），无则补 import。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/server && uv run pytest tests/test_resource_static.py -v`
Expected: 4 PASS

- [ ] **Step 5: 提交**

```bash
git add apps/server/src/api/chat_api.py apps/server/tests/test_resource_static.py
git commit -m "feat(server): add inline path-based static resource endpoint for HTML preview"
```

---

## Task 2: 前端 browser-store.openHtmlPreview

**Files:**
- Modify: `apps/web/src/stores/browser-store.ts`
- Test: `apps/web/src/stores/browser-store.test.ts`

- [ ] **Step 1: 写失败测试（vitest）**

```typescript
// apps/web/src/stores/browser-store.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

// 模拟 electron api 与 request base
const openSpy = vi.fn()
vi.mock("@/lib/electron/host", () => ({
  getElectronApi: () => ({ browser: { open: openSpy } }),
}))
vi.mock("@/lib/request", () => ({
  getRequestBaseUrl: () => "http://127.0.0.1:34567",
}))

import { useBrowserStore } from "./browser-store"

describe("openHtmlPreview", () => {
  beforeEach(() => {
    openSpy.mockClear()
    useBrowserStore.getState().reset()
  })

  it("把对话 HTML 拼成后端 static URL 并走 openBrowser", () => {
    useBrowserStore.getState().openHtmlPreview(123, "/artifacts/report.html")
    const expected =
      "http://127.0.0.1:34567/chat/conversations/123/resources/static/artifacts/report.html"
    expect(openSpy).toHaveBeenCalledWith(expected)
    expect(useBrowserStore.getState().isOpen).toBe(true)
    expect(useBrowserStore.getState().currentUrl).toBe(expected)
  })

  it("去掉 virtualPath 前导斜杠，避免双斜杠", () => {
    useBrowserStore.getState().openHtmlPreview(1, "artifacts/a.html")
    expect(openSpy).toHaveBeenCalledWith(
      "http://127.0.0.1:34567/chat/conversations/1/resources/static/artifacts/a.html"
    )
  })
})
```

> 注：确认 `@/lib/request` 确实导出 `getRequestBaseUrl`（Explore 报告 request.ts:98）。若导出名不同，按实际调整 mock 与实现。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/web && pnpm test:unit src/stores/browser-store.test.ts`
Expected: FAIL（`openHtmlPreview is not a function`）

- [ ] **Step 3: 实现 openHtmlPreview**

在 `browser-store.ts`：
1. 顶部 import：`import { getRequestBaseUrl } from "@/lib/request"`
2. `BrowserState` 接口加：`openHtmlPreview: (conversationId: string | number, virtualPath: string) => void`
3. 实现（复用 openBrowser）：

```typescript
openHtmlPreview: (conversationId, virtualPath) => {
  const base = getRequestBaseUrl().replace(/\/$/, "")
  const rel = virtualPath.replace(/^\//, "")
  const url = `${base}/chat/conversations/${conversationId}/resources/static/${rel}`
  get().openBrowser(url)
},
```

> `openBrowser` 内部 `normalizeUrl` 对已带 `http://` 的 URL 原样返回，不会被改写。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/web && pnpm test:unit src/stores/browser-store.test.ts`
Expected: PASS

- [ ] **Step 5: typecheck + 提交**

```bash
cd apps/web && pnpm typecheck
git add apps/web/src/stores/browser-store.ts apps/web/src/stores/browser-store.test.ts
git commit -m "feat(web): add browser-store.openHtmlPreview for opening conversation HTML in browser-panel"
```

---

## Task 3: FileChangeCard 对 HTML 分流

**Files:**
- Modify: `apps/web/src/components/chat/message-blocks/file-change-cards.tsx`
- Test: `apps/web/src/components/chat/message-blocks/file-open-routing.test.ts`

**设计：** 把"点击某文件该走哪个 open"抽成纯函数便于测试，组件内调用它。

- [ ] **Step 1: 写失败测试（vitest，测纯函数）**

```typescript
// apps/web/src/components/chat/message-blocks/file-open-routing.test.ts
import { describe, it, expect, vi } from "vitest"
import { resolveFileOpen } from "./file-open-routing"

describe("resolveFileOpen", () => {
  it("html 文件且有 conversationId → openHtmlPreview", () => {
    const openHtmlPreview = vi.fn()
    const openResource = vi.fn()
    resolveFileOpen("/artifacts/a.html", {
      conversationId: 5,
      openHtmlPreview,
      openResource,
    })
    expect(openHtmlPreview).toHaveBeenCalledWith(5, "/artifacts/a.html")
    expect(openResource).not.toHaveBeenCalled()
  })

  it("非 html → openResource", () => {
    const openHtmlPreview = vi.fn()
    const openResource = vi.fn()
    resolveFileOpen("/artifacts/a.md", {
      conversationId: 5,
      openHtmlPreview,
      openResource,
    })
    expect(openResource).toHaveBeenCalledWith("/artifacts/a.md")
    expect(openHtmlPreview).not.toHaveBeenCalled()
  })

  it("html 但无 conversationId → 退回 openResource", () => {
    const openHtmlPreview = vi.fn()
    const openResource = vi.fn()
    resolveFileOpen("/artifacts/a.html", {
      conversationId: null,
      openHtmlPreview,
      openResource,
    })
    expect(openResource).toHaveBeenCalledWith("/artifacts/a.html")
    expect(openHtmlPreview).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/web && pnpm test:unit src/components/chat/message-blocks/file-open-routing.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现纯函数**

```typescript
// apps/web/src/components/chat/message-blocks/file-open-routing.ts
import { isHtmlPath } from "@/components/artifact/artifact-content/resolve-renderer"

export interface FileOpenHandlers {
  conversationId: string | number | null | undefined
  openHtmlPreview: (conversationId: string | number, path: string) => void
  openResource: (path: string) => void
}

export function resolveFileOpen(path: string, h: FileOpenHandlers): void {
  if (isHtmlPath(path) && h.conversationId != null) {
    h.openHtmlPreview(h.conversationId, path)
    return
  }
  h.openResource(path)
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/web && pnpm test:unit src/components/chat/message-blocks/file-open-routing.test.ts`
Expected: 3 PASS

- [ ] **Step 5: 接到组件**

在 `file-change-cards.tsx`：
1. import：`useBrowserStore`、`resolveFileOpen`
2. 取 `const openHtmlPreview = useBrowserStore((s) => s.openHtmlPreview)`
3. 把 `handleOpen` 改为：

```typescript
const handleOpen = React.useCallback(
  (path: string) => {
    // curator 场景仍走其自定义打开；否则按类型分流
    if (curatorFile?.onOpenFile) {
      curatorFile.onOpenFile(path)
      return
    }
    resolveFileOpen(path, { conversationId, openHtmlPreview, openResource })
  },
  [curatorFile, conversationId, openHtmlPreview, openResource]
)
```

> 保持 curator 上下文优先（不破坏 skill curator 文件查看）。其余 HTML 走新面板，非 HTML 照旧资源管理器。

- [ ] **Step 6: typecheck + 提交**

```bash
cd apps/web && pnpm typecheck
git add apps/web/src/components/chat/message-blocks/file-open-routing.ts \
        apps/web/src/components/chat/message-blocks/file-open-routing.test.ts \
        apps/web/src/components/chat/message-blocks/file-change-cards.tsx
git commit -m "feat(web): route HTML file cards to browser-panel preview"
```

---

## Task 4: 手动 E2E 验证（需 GUI，无法自动化）

- [ ] **Step 1: 重启 dev:app** `pnpm --filter web dev:app`（改了 Electron 不强制，但前后端都改了，重启最稳）

- [ ] **Step 2: 自包含 HTML**：让 Agent 生成一个内联 CSS/JS 的 HTML，点其 FileChangeCard → 应在 browser-panel 渲染（不是资源管理器、不是下载）。

- [ ] **Step 3: 带相对资源**：生成 `report.html` + 同目录 `style.css`，`report.html` 用 `<link href="./style.css">`，点开 → 样式生效（相对资源经 static 端点加载）。

- [ ] **Step 4: browserctl 交互**：browser-panel 打开 HTML 后，`browserctl snapshot --interactive` → 能列出该 HTML 的可交互节点（验证自然语言交互闭环）。

- [ ] **Step 5: 非 HTML 回归**：点 `.md`/`.png` 卡片 → 仍在资源管理器打开（分流没误伤）。

- [ ] **Step 6: 边界**：点不存在/越权路径不应崩（static 端点 404）。

---

## 完成定义

- 后端 `test_resource_static.py` 全绿（pytest）
- 前端 `browser-store.test.ts` + `file-open-routing.test.ts` 全绿（vitest，`pnpm test:unit`）
- `pnpm --filter digital-employee typecheck` 通过
- 手动 E2E（Task 4）通过：自包含 HTML、相对资源、browserctl 交互、非 HTML 回归
