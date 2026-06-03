# 阶段 1：MVP 内嵌三方页面 + 手动浏览 — 实施文档

> 预计工期：1 周 | 状态：基本完成（互斥/tab/外链转发已补）

## 目标

在主窗口右侧新增可拖拽（默认 60% 宽、30%–80% 区间）的子 `BrowserWindow`，承载任意 URL；用户可手动浏览；离线模式可用。

---

## 代码模式速查

本功能需遵循项目已有的 4 层 IPC 架构：

```
Layer 1 — Channel 常量   → shared/ipc-channels.ts (IpcChannels + IpcInvokeMap)
Layer 2 — 主进程 handler  → features/browser/ipc.ts (IpcContribution)
Layer 3 — 贡献注册表      → core/ipc/registry.ts (自动遍历 allIpcContributions)
Layer 4 — 渲染进程桥      → features/browser/preload-bridge.ts (invoke/onChannel)
```

---

## 实施步骤

### Step 1.1 — IPC Channel 常量

**修改文件：** `apps/web/electron/shared/ipc-channels.ts`

```typescript
// === IpcChannels 对象新增 ===
browserOpen: "browser:open",
browserClose: "browser:close",
browserNavigate: "browser:navigate",
browserResize: "browser:resize",
browserSetUrl: "browser:set-url",       // 主进程 → 渲染：URL 变化通知

// === IpcInvokeMap 接口新增 ===
[IpcChannels.browserOpen]: {
  args: [url: string, bounds: { x: number; y: number; width: number; height: number }]
  result: void
},
[IpcChannels.browserClose]: { args: []; result: void },
[IpcChannels.browserNavigate]: { args: [url: string]; result: void },
[IpcChannels.browserResize]: {
  args: [bounds: { x: number; y: number; width: number; height: number }]
  result: void
},
```

### Step 1.2 — Electron Feature：browser/

**新建目录：** `apps/web/electron/features/browser/`

#### 1.2.1 browser-window-controller.ts

**新建文件：** `apps/web/electron/features/browser/browser-window-controller.ts`

职责：管理子 `BrowserWindow` 生命周期（创建/显示/隐藏/销毁），同步位置和大小。

```typescript
import { BrowserWindow, session, screen } from "electron"
import type { Rectangle, BrowserWindow as BW } from "electron"

export class BrowserWindowController {
  private win: BW | null = null
  private parentWin: BW | null = null

  attachParent(parent: BW) {
    this.parentWin = parent
  }

  open(url: string, bounds: Rectangle) {
    if (this.win && !this.win.isDestroyed()) {
      this.win.setBounds(bounds)
      this.win.loadURL(url)
      this.win.show()
      return
    }

    const partition = "persist:browser-panel"
    const ses = session.fromPartition(partition)

    this.win = new BrowserWindow({
      parent: this.parentWin!,
      ...bounds,
      frame: false,
      show: false,
      webPreferences: {
        session: ses,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    })

    this.win.loadURL(url)

    this.win.webContents.on("did-finish-load", () => {
      this.win?.show()
      this.notifyUrlChange()
    })

    this.win.webContents.on("did-navigate-in-page", () => this.notifyUrlChange())
    this.win.webContents.on("did-navigate", () => this.notifyUrlChange())

    this.win.on("closed", () => {
      this.win = null
    })
  }

  navigate(url: string) {
    this.win?.loadURL(url)
  }

  resize(bounds: Rectangle) {
    this.win?.setBounds(bounds)
  }

  hide() {
    this.win?.hide()
  }

  close() {
    if (this.win && !this.win.isDestroyed()) {
      this.win.close()
      this.win = null
    }
  }

  getWebContents() {
    return this.win?.webContents ?? null
  }

  isOpen(): boolean {
    return this.win !== null && !this.win.isDestroyed()
  }

  private notifyUrlChange() {
    if (!this.win || this.win.isDestroyed()) return
    this.parentWin?.webContents.send("browser:set-url", {
      url: this.win.webContents.getURL(),
      title: this.win.webContents.getTitle(),
    })
  }
}
```

#### 1.2.2 ipc.ts

**新建文件：** `apps/web/electron/features/browser/ipc.ts`

遵循 `IpcContribution` 模式（参考 `features/window/ipc.ts`）。

```typescript
import { IpcChannels } from "../../shared/ipc-channels"
import type { IpcContribution } from "../../core/ipc/types"
import { BrowserWindowController } from "./browser-window-controller"

const controller = new BrowserWindowController()

export const browserIpcContribution: IpcContribution = {
  id: "browser",
  register(ctx) {
    controller.attachParent(ctx.mainWindow)

    return [
      {
        channel: IpcChannels.browserOpen,
        handler: async (_event, url: string, bounds: { x: number; y: number; width: number; height: number }) => {
          controller.open(url, bounds)
        },
      },
      {
        channel: IpcChannels.browserClose,
        handler: async () => {
          controller.close()
        },
      },
      {
        channel: IpcChannels.browserNavigate,
        handler: async (_event, url: string) => {
          controller.navigate(url)
        },
      },
      {
        channel: IpcChannels.browserResize,
        handler: async (_event, bounds: { x: number; y: number; width: number; height: number }) => {
          controller.resize(bounds)
        },
      },
    ]
  },
}
```

#### 1.2.3 preload-bridge.ts

**新建文件：** `apps/web/electron/features/browser/preload-bridge.ts`

```typescript
import { invoke, onChannel } from "../../preload/invoke"
import { IpcChannels } from "../../shared/ipc-channels"

export const browserBridge = {
  open: (url: string, bounds: { x: number; y: number; width: number; height: number }) =>
    invoke(IpcChannels.browserOpen, url, bounds),
  close: () => invoke(IpcChannels.browserClose),
  navigate: (url: string) => invoke(IpcChannels.browserNavigate, url),
  resize: (bounds: { x: number; y: number; width: number; height: number }) =>
    invoke(IpcChannels.browserResize, bounds),
  onUrlChange: (callback: (data: { url: string; title: string }) => void) =>
    onChannel("browser:set-url", (data) => callback(data as { url: string; title: string })),
}
```

### Step 1.3 — 注册到 Feature barrel

**修改文件：** `apps/web/electron/features/index.ts`

```typescript
import { browserIpcContribution } from "./browser/ipc"

export const allIpcContributions: IpcContribution[] = [
  // ... 现有
  browserIpcContribution,
]
```

### Step 1.4 — 注入 Preload Bridge

**修改文件：** `apps/web/electron/preload/electron-api.ts`

```typescript
import { browserBridge } from "../features/browser/preload-bridge"

export const electronApi = {
  isElectron: true as const,
  ...windowBridge,
  // ... 现有
  browser: browserBridge,
}
```

### Step 1.5 — 主窗口 resize 联动

**修改文件：** `apps/web/electron/main/index.ts`

```typescript
// 在 mainWindow 创建后添加：
mainWindow.on("resize", () => {
  // 通知渲染进程重新计算 bounds（由 browser-store 处理）
  mainWindow.webContents.send("main:resized")
})
```

**修改 `setWindowOpenHandler`：**

```typescript
win.webContents.setWindowOpenHandler(({ url }) => {
  // 新增：转发到内嵌浏览器（由 browser-store 决定是否打开）
  win.webContents.send("browser:request-open", { url })
  return { action: "deny" }
})
```

### Step 1.6 — Zustand Store

**新建文件：** `apps/web/src/stores/browser-store.ts`

遵循 `monitor-store.ts` 模式：`open*()` 时关闭竞争面板。

```typescript
import { create } from "zustand"
import { useMonitorStore } from "./monitor-store"
import { useArtifactStore } from "./artifact-store"
import { useChatStore } from "./chat-store"

const DEFAULT_WIDTH_RATIO = 0.6
const HEADER_HEIGHT = 40

interface BrowserStore {
  isOpen: boolean
  currentUrl: string
  currentTitle: string
  widthRatio: number
  isLoading: boolean
  error: string | null

  openBrowser: (url?: string) => void
  closeBrowser: () => void
  navigate: (url: string) => void
  setWidthRatio: (ratio: number) => void
  setUrlFromMain: (url: string, title: string) => void
  setError: (error: string | null) => void
}

function calcBounds(widthRatio: number) {
  const mainEl = document.querySelector(".chat-layout") as HTMLElement
  if (!mainEl) return null
  const rect = mainEl.getBoundingClientRect()
  return {
    x: Math.round(rect.left + rect.width * (1 - widthRatio)),
    y: Math.round(rect.top + HEADER_HEIGHT),
    width: Math.round(rect.width * widthRatio),
    height: Math.round(rect.height - HEADER_HEIGHT),
  }
}

function closeOtherPanels() {
  useMonitorStore.getState().closeMonitor()
  useArtifactStore.getState().closeArtifact()
  useChatStore.getState().closeConversationList()
}

export const useBrowserStore = create<BrowserStore>((set, get) => ({
  isOpen: false,
  currentUrl: "",
  currentTitle: "",
  widthRatio: DEFAULT_WIDTH_RATIO,
  isLoading: false,
  error: null,

  openBrowser: (url = "https://www.baidu.com") => {
    closeOtherPanels()
    useChatStore.getState().setActiveTab("chat")

    const bounds = calcBounds(get().widthRatio)
    if (bounds) {
      window.electronAPI?.browser?.open(url, bounds)
    }
    set({ isOpen: true, currentUrl: url, isLoading: true, error: null })
  },

  closeBrowser: () => {
    window.electronAPI?.browser?.close()
    set({ isOpen: false, currentUrl: "", currentTitle: "", error: null })
  },

  navigate: (url) => {
    window.electronAPI?.browser?.navigate(url)
    set({ currentUrl: url, isLoading: true, error: null })
  },

  setWidthRatio: (ratio) => {
    const clamped = Math.max(0.3, Math.min(0.8, ratio))
    set({ widthRatio: clamped })
    const bounds = calcBounds(clamped)
    if (bounds) {
      window.electronAPI?.browser?.resize(bounds)
    }
  },

  setUrlFromMain: (url, title) => {
    set({ currentUrl: url, currentTitle: title, isLoading: false })
  },

  setError: (error) => {
    set({ error, isLoading: false })
  },
}))



// 更新 reset helper
// 修改 apps/web/src/lib/chat/reset-chat-right-panels.ts
// 添加：useBrowserStore.getState().closeBrowser()
```

**修改文件：** `apps/web/src/lib/chat/reset-chat-right-panels.ts`

```typescript
import { useBrowserStore } from "@/stores/browser-store"

export function resetChatRightPanels() {
  // ... 现有
  useBrowserStore.getState().closeBrowser()
}
```

### Step 1.7 — ChatLayout 集成

**修改文件：** `apps/web/src/components/chat/shell/chat-layout.tsx`

```typescript
// 1. 扩展 RightPanel 类型
type RightPanel = "artifact" | "monitor" | "conversations" | "browser"

// 2. 引入 store
import { useBrowserStore } from "@/stores/browser-store"

// 3. 在面板优先级中添加 browser
const { isOpen: isBrowserOpen } = useBrowserStore()
// 在 rightPanel 计算中加一级：
// isBrowserOpen ? "browser" : ...

// 4. 渲染 browser 面板（占位 + 状态栏）
{hasRightPanel && activeTab === "chat" && rightPanel === "browser" && (
  <div className={cn(RIGHT_PANEL_SHELL, "flex flex-col")} style={{ width: `${browserWidthRatio * 100}%` }}>
    <BrowserPanel />
  </div>
)}
```

### Step 1.8 — BrowserPanel 组件

**新建文件：** `apps/web/src/components/browser/browser-panel.tsx`

（注：真实目录按现有组件组织，不建 `right-panels/`）

```tsx
import * as React from "react"
import { useBrowserStore } from "@/stores/browser-store"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { X, RefreshCw } from "lucide-react"
import { cn } from "@workspace/ui/lib/utils"

export function BrowserPanel({ className }: { className?: string }) {
  const { currentUrl, currentTitle, isLoading, error, closeBrowser, navigate } =
    useBrowserStore()
  const [urlInput, setUrlInput] = React.useState(currentUrl)

  React.useEffect(() => {
    setUrlInput(currentUrl)
  }, [currentUrl])

  React.useEffect(() => {
    const unsub = window.electronAPI?.browser?.onUrlChange(({ url, title }) => {
      useBrowserStore.getState().setUrlFromMain(url, title)
    })
    return () => unsub?.()
  }, [])

  const handleNavigate = () => {
    let url = urlInput.trim()
    if (!url) return
    if (!/^https?:\/\//.test(url)) url = "https://" + url
    navigate(url)
  }

  return (
    <div className={cn("flex h-full flex-col", className)}>
      {/* URL bar */}
      <div className="flex items-center gap-1.5 border-b px-2 py-1.5">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => navigate(currentUrl)}
        >
          <RefreshCw className={cn("h-3.5 w-3.5", isLoading && "animate-spin")} />
        </Button>
        <Input
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleNavigate()}
          placeholder="输入 URL..."
          className="h-7 flex-1 text-sm"
        />
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={closeBrowser}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {error && (
        <div className="bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
          加载失败: {error}
        </div>
      )}

      {/* 占位区 — 实际内容在子 BrowserWindow */}
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        {isLoading ? "加载中..." : currentTitle || "输入 URL 开始浏览"}
      </div>

      {/* 底部状态 */}
      <div className="truncate border-t px-2 py-1 text-xs text-muted-foreground">
        {currentUrl}
      </div>
    </div>
  )
}
```

### Step 1.9 — 工具栏 Globe 按钮

**修改文件：** `apps/web/src/components/chat/shell/app-toolbar.tsx`

在工具栏底部区域（settings 按钮附近）添加 Globe 按钮：

```tsx
import { Globe } from "lucide-react"
import { useBrowserStore } from "@/stores/browser-store"

// 在组件内部：
const { isOpen: isBrowserOpen, openBrowser, closeBrowser } = useBrowserStore()

// 渲染（settings 按钮之前）：
<button
  className={cn(
    "toolbar-btn",
    isBrowserOpen && "bg-accent text-accent-foreground"
  )}
  onClick={() => (isBrowserOpen ? closeBrowser() : openBrowser())}
  title="浏览器"
>
  <Globe className="h-5 w-5" />
</button>
```

### Step 1.10 — TypeScript 类型补充

**修改文件：** `apps/web/src/types/electron.d.ts`（如不存在则新建）

```typescript
export interface ElectronApi {
  // ... 现有
  browser?: {
    open: (url: string, bounds: { x: number; y: number; width: number; height: number }) => Promise<void>
    close: () => Promise<void>
    navigate: (url: string) => Promise<void>
    resize: (bounds: { x: number; y: number; width: number; height: number }) => Promise<void>
    onUrlChange: (callback: (data: { url: string; title: string }) => void) => () => void
  }
}
```

---

## 新增/修改文件清单

### 新增 5 个

| # | 路径 | 职责 |
|---|------|------|
| 1 | `apps/web/electron/features/browser/browser-window-controller.ts` | 子窗口生命周期 |
| 2 | `apps/web/electron/features/browser/ipc.ts` | IpcContribution 注册 |
| 3 | `apps/web/electron/features/browser/preload-bridge.ts` | 渲染进程 bridge |
| 4 | `apps/web/src/stores/browser-store.ts` | Zustand store |
| 5 | `apps/web/src/components/browser/browser-panel.tsx` | 面板 UI |

### 修改 7 个

| # | 路径 | 改动 |
|---|------|------|
| 1 | `apps/web/electron/shared/ipc-channels.ts` | 新增 5 个 channel |
| 2 | `apps/web/electron/features/index.ts` | 注册 browserIpcContribution |
| 3 | `apps/web/electron/preload/electron-api.ts` | 注入 browserBridge |
| 4 | `apps/web/electron/main/index.ts` | resize 联动 + setWindowOpenHandler 改造 |
| 5 | `apps/web/src/components/chat/shell/chat-layout.tsx` | RightPanel += "browser" |
| 6 | `apps/web/src/components/chat/shell/app-toolbar.tsx` | Globe 按钮 |
| 7 | `apps/web/src/lib/chat/reset-chat-right-panels.ts` | 新增 closeBrowser |

---

## 验收标准

- [ ] 打开主窗口 → 点工具栏 Globe → 右侧抽屉出现，宽 60% 主窗口
- [ ] URL bar 输入 `https://example.com` 回车 → 子 BrowserWindow 加载
- [ ] 拖动宽度滑块 30% / 80% → 子窗口同步
- [ ] 关闭抽屉 → 子窗口隐藏但 partition 保留 Cookie
- [ ] 切到 Workbench / Skills tab → 浏览器面板同步隐藏
- [ ] `OFFLINE_MODE=1` 启动 → 仍能加载离线可达页面
- [ ] macOS / Windows / Linux 三端冒烟通过

## 测试命令

```bash
pnpm typecheck
pnpm lint
pnpm --filter digital-employee dev:app
```
