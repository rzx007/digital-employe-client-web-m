# 工作台看板重构（总管生成 HTML → 钉成网格面板）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把工作台中间区从「解析技能接口→固定 6 种图表」替换为「总管对话生成的 HTML 产物→钉成网格面板」，每个看板在沙箱 iframe 内自带 fetch 实时拉数据。

**Architecture:** `WorkbenchBlock` 内容来源由 `queryInterface` 改为 `htmlRef{conversationId, resourcePath}`。新增 `WorkbenchHtmlPanel` 取 HTML 源码并复用现有 `HtmlArtifactRenderer` 渲染；资源面板 `.html` 文件加「钉到工作台」入口写入 workbench config。网格/拖拽/缩放/localStorage 持久化壳全部保留，删除整套接口解析与 recharts 渲染文件。

**Tech Stack:** React 19 + TypeScript + TanStack Query + Zustand + dnd-kit + Vitest(happy-dom)。测试命令 `pnpm --filter web test:unit`，类型检查 `pnpm --filter web typecheck`。

---

## 重要约定

- **工作目录**：`apps/web`，所有相对路径以 `apps/web/` 为根。
- **测试运行**：`cd apps/web && pnpm test:unit`（底层 `vitest run`）。单文件：`pnpm test:unit src/path/x.test.ts`。
- **类型检查**：`cd apps/web && pnpm typecheck`。
- **React 组件/hook 测试**：文件顶部加 `// @vitest-environment happy-dom`。
- **代码风格**：无分号、双引号、2 空格缩进、尾逗号。提交前可 `pnpm format`。
- **导入别名**：`@/*` → `apps/web/src/*`，`@workspace/ui/*` → 共享 UI 包。

---

## File Structure

**新增：**
- `apps/web/src/components/workbench/workbench-html-panel.tsx` — 单看板组件：取 HTML 源码 → `HtmlArtifactRenderer`，顶栏刷新/删除/缺失占位。
- `apps/web/src/components/workbench/workbench-html-panel.test.tsx` — 缺失占位 / 渲染分支测试。

**改造：**
- `apps/web/src/types/workbench.ts` — 删旧枚举/`QueryInterface`，新增 `HtmlArtifactRef`，`WorkbenchBlock` 改字段。
- `apps/web/src/lib/workbench/workbench-config.ts` — 删技能初始化，新增 `addHtmlArtifactBlock` + 旧配置检测重置。
- `apps/web/src/lib/workbench/workbench-config.test.ts`（新建）— 配置增删/旧配置重置测试。
- `apps/web/src/hooks/use-workbench-config.ts` — `addBlock`→`pinHtmlArtifact`，去掉 `skills` 依赖。
- `apps/web/src/components/workbench/draggable-workbench-grid.tsx` — 每格渲染 `WorkbenchHtmlPanel`。
- `apps/web/src/components/chat/views/workbench-view.tsx` — 删技能加载/AddBlockDialog/添加模块按钮。
- `apps/web/src/components/artifact/artifact-panel.tsx` — `.html` 文件右键加「钉到工作台」。

**删除：**
- 组件：`add-block-dialog.tsx`、`data-visualizer.tsx`、`skill-block-renderer.tsx`
- lib：`query-interface-parser.ts`、`query-interface-resolve.ts`、`response-field-analyzer.ts`、`parse-response-rows.ts`、`ai-extract-headers.ts`、`http-headers.ts`、`skill-url-extract.ts`、`url-template-params.ts`、`skill-block-mappings.ts`、`skill-interfaces-cache.ts`、`chat-send-employee.ts`、`local-skill-loader.ts`

**保留不动：** `workbench-content-split.tsx`、`workbench-left-panel.tsx`、`workbench-performance-section.tsx`、`performance-metrics-card.tsx`、`today-task-list.tsx`、`task-status-badge.tsx`、`workbench-shift-calendar-sheet.tsx`、`workbench-curator-sessions-sheet.tsx`、`resolve-workbench-curator-panel.ts(.test)`、`HtmlArtifactRenderer` 及 artifact 管道。

---

## Task 0: 前置验证 —— 沙箱内 fetch 能否打到内网接口

> ⚠️ 这是设计里标的最大不确定项。**先验证再写代码**。结论决定后续是否需要补代理层。

**Files:** 无（手动验证，不提交代码）

- [ ] **Step 1: 准备一个最小 fetch HTML**

在任意一个总管会话里，让总管（或手动）在 `/artifacts/` 下放一个 `test-fetch.html`，内容：

```html
<!DOCTYPE html>
<html><head><meta charset="utf-8"></head><body>
<pre id="out">loading...</pre>
<script>
  // 把下面替换成一个真实的内网接口地址（GET、返回 JSON）
  fetch("http://<真实内网IP:端口>/<真实接口路径>")
    .then(r => r.json())
    .then(d => { document.getElementById("out").textContent = "OK: " + JSON.stringify(d).slice(0, 500) })
    .catch(e => { document.getElementById("out").textContent = "FAIL: " + e })
</script>
</body></html>
```

- [ ] **Step 2: 在资源面板预览该 HTML**

启动应用（`pnpm --filter web dev:app`），打开工作台 → 右侧总管会话 → 资源面板 → 选中 `test-fetch.html` 预览。观察 iframe 内显示 `OK:` 还是 `FAIL:`。同时打开 DevTools 看 Network/Console 是否 CORS 报错。

- [ ] **Step 3: 记录结论**

- **若显示 OK** → 沙箱内 fetch 可达，按本 plan Task 1 起全量实现。
- **若 CORS/Origin 失败** → **停止**，回到 spec 补代理子方案（Electron 主进程 `net.request` 转发 或 后端 `/proxy`），再继续。在 plan 末尾「执行记录」处写下结论。

---

## Task 1: 重定义 Workbench 类型

**Files:**
- Modify: `apps/web/src/types/workbench.ts`（整文件替换）

- [ ] **Step 1: 替换 types/workbench.ts 全文**

```typescript
/**
 * 指向某个总管会话产出的 HTML 产物文件
 */
export interface HtmlArtifactRef {
  /** 产出该 HTML 的总管会话 */
  conversationId: string | number
  /** 会话内资源路径，如 /artifacts/sales-dashboard.html */
  resourcePath: string
  /** 钉住时间戳 */
  pinnedAt: number
}

/**
 * 工作台看板块：唯一类型为总管生成的 HTML 产物引用
 */
export interface WorkbenchBlock {
  id: string
  type: "html-artifact"
  title: string
  enabled: boolean
  order: number
  htmlRef: HtmlArtifactRef
  /** 自定义宽度（像素），沿用现有网格逻辑 */
  width?: number
  /** 自定义高度（像素） */
  height?: number
}

/**
 * 工作台配置（按 employeeId 存 localStorage，工作台用 "global"）
 */
export interface WorkbenchConfig {
  employeeId: string
  blocks: WorkbenchBlock[]
  lastModified: number
}

/**
 * 任务状态（task-status-badge / today-task-list 用，保留）
 */
export type TaskStatus =
  | "success"
  | "failed"
  | "pending"
  | "running"
  | "timeout"
  | "stuck"
  | "cancelled"
```

> 注意：删除了 `BlockType`、`ChartDisplayType`、`QueryInterface`、`SkillBlockMapping`。`TaskStatus` 保留（被 `task-status-badge.tsx` 等使用）。

- [ ] **Step 2: 类型检查（预期此处会因下游引用报错，属正常）**

Run: `cd apps/web && pnpm typecheck`
Expected: 报错集中在 `workbench-config.ts`、`use-workbench-config.ts`、`draggable-workbench-grid.tsx`、`data-visualizer.tsx`、`add-block-dialog.tsx`、`skill-block-renderer.tsx` —— 这些将在后续任务删除或改造。**先不修，继续 Task 2。**

- [ ] **Step 3: 暂不提交**（等 Task 2 一起提交，避免中间态 typecheck 失败的提交）

---

## Task 2: 重写 workbench-config（删技能初始化 + 旧配置重置 + addHtmlArtifactBlock）

**Files:**
- Modify: `apps/web/src/lib/workbench/workbench-config.ts`（整文件替换）
- Test: `apps/web/src/lib/workbench/workbench-config.test.ts`（新建）

- [ ] **Step 1: 写失败测试 workbench-config.test.ts**

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { HtmlArtifactRef, WorkbenchConfig } from "@/types/workbench"
import {
  addHtmlArtifactBlock,
  loadWorkbenchConfig,
  removeBlock,
  saveWorkbenchConfig,
  updateBlockOrder,
} from "./workbench-config"

const KEY = "workbench-config-global"

function makeRef(path: string): HtmlArtifactRef {
  return { conversationId: 12, resourcePath: path, pinnedAt: 1 }
}

beforeEach(() => {
  localStorage.clear()
  vi.spyOn(Date, "now").mockReturnValue(1000)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("loadWorkbenchConfig", () => {
  it("returns null when nothing stored", () => {
    expect(loadWorkbenchConfig("global")).toBeNull()
  })

  it("resets legacy config (block missing html-artifact type) to null", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        employeeId: "global",
        blocks: [{ id: "x", type: "custom", queryInterface: { id: "i" } }],
        lastModified: 1,
      })
    )
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(loadWorkbenchConfig("global")).toBeNull()
    expect(warn).toHaveBeenCalled()
  })

  it("loads a valid html-artifact config", () => {
    const cfg: WorkbenchConfig = {
      employeeId: "global",
      blocks: [
        {
          id: "b1",
          type: "html-artifact",
          title: "看板",
          enabled: true,
          order: 0,
          htmlRef: makeRef("/artifacts/a.html"),
        },
      ],
      lastModified: 1,
    }
    localStorage.setItem(KEY, JSON.stringify(cfg))
    expect(loadWorkbenchConfig("global")).toEqual(cfg)
  })
})

describe("addHtmlArtifactBlock", () => {
  it("appends a new html-artifact block and persists", () => {
    const base: WorkbenchConfig = {
      employeeId: "global",
      blocks: [],
      lastModified: 1,
    }
    const next = addHtmlArtifactBlock(base, makeRef("/artifacts/a.html"), "销售看板")
    expect(next.blocks).toHaveLength(1)
    expect(next.blocks[0]).toMatchObject({
      type: "html-artifact",
      title: "销售看板",
      enabled: true,
      order: 0,
      htmlRef: { resourcePath: "/artifacts/a.html" },
    })
    expect(loadWorkbenchConfig("global")?.blocks).toHaveLength(1)
  })
})

describe("removeBlock / updateBlockOrder", () => {
  it("removes a block and re-orders remaining", () => {
    let cfg: WorkbenchConfig = { employeeId: "global", blocks: [], lastModified: 1 }
    cfg = addHtmlArtifactBlock(cfg, makeRef("/a.html"), "A")
    cfg = addHtmlArtifactBlock(cfg, makeRef("/b.html"), "B")
    const firstId = cfg.blocks[0]!.id
    cfg = removeBlock(cfg, firstId)
    expect(cfg.blocks).toHaveLength(1)
    expect(cfg.blocks[0]!.order).toBe(0)
  })

  it("reorders blocks by id list", () => {
    let cfg: WorkbenchConfig = { employeeId: "global", blocks: [], lastModified: 1 }
    cfg = addHtmlArtifactBlock(cfg, makeRef("/a.html"), "A")
    cfg = addHtmlArtifactBlock(cfg, makeRef("/b.html"), "B")
    const [a, b] = cfg.blocks.map((x) => x.id)
    cfg = updateBlockOrder(cfg, [b!, a!])
    expect(cfg.blocks.map((x) => x.id)).toEqual([b, a])
    expect(cfg.blocks.map((x) => x.order)).toEqual([0, 1])
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd apps/web && pnpm test:unit src/lib/workbench/workbench-config.test.ts`
Expected: FAIL（`addHtmlArtifactBlock` 等未定义 / 旧逻辑仍引用已删类型）

- [ ] **Step 3: 整文件替换 workbench-config.ts**

```typescript
import type { HtmlArtifactRef, WorkbenchBlock, WorkbenchConfig } from "@/types/workbench"

const STORAGE_KEY_PREFIX = "workbench-config-"

function getStorageKey(employeeId: string): string {
  return `${STORAGE_KEY_PREFIX}${employeeId}`
}

/** 生成唯一 block id（不依赖 Date.now，避免与 mock 冲突；用随机串足够） */
function generateBlockId(): string {
  return `wb-${Math.random().toString(36).slice(2, 10)}`
}

/** 校验是否为重构后的合法 config（所有 block 必须是 html-artifact + 带 htmlRef） */
function isValidConfig(raw: unknown): raw is WorkbenchConfig {
  if (!raw || typeof raw !== "object") return false
  const cfg = raw as WorkbenchConfig
  if (!Array.isArray(cfg.blocks)) return false
  return cfg.blocks.every(
    (b) =>
      b &&
      typeof b === "object" &&
      (b as WorkbenchBlock).type === "html-artifact" &&
      !!(b as WorkbenchBlock).htmlRef &&
      typeof (b as WorkbenchBlock).htmlRef.resourcePath === "string"
  )
}

/**
 * 从 localStorage 加载工作台配置；检测到旧结构（含 queryInterface / 非 html-artifact）
 * 一律重置为 null（调用方据此初始化空白工作台），并 console.warn 提示，不静默。
 */
export function loadWorkbenchConfig(employeeId: string): WorkbenchConfig | null {
  try {
    const raw = localStorage.getItem(getStorageKey(employeeId))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!isValidConfig(parsed)) {
      console.warn(
        "[workbench] 检测到旧版工作台配置（不兼容新看板模型），已重置为空白工作台"
      )
      localStorage.removeItem(getStorageKey(employeeId))
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export function saveWorkbenchConfig(config: WorkbenchConfig): void {
  try {
    localStorage.setItem(getStorageKey(config.employeeId), JSON.stringify(config))
  } catch (e) {
    console.error("Failed to save workbench config:", e)
  }
}

/** 初始化空白工作台配置（不再从技能创建块） */
export function initializeWorkbenchConfig(employeeId: string): WorkbenchConfig {
  const existing = loadWorkbenchConfig(employeeId)
  if (existing) {
    existing.lastModified = Date.now()
    saveWorkbenchConfig(existing)
    return existing
  }
  const config: WorkbenchConfig = {
    employeeId,
    blocks: [],
    lastModified: Date.now(),
  }
  saveWorkbenchConfig(config)
  return config
}

/** 把一个总管生成的 HTML 产物钉成看板块 */
export function addHtmlArtifactBlock(
  config: WorkbenchConfig,
  htmlRef: HtmlArtifactRef,
  title: string
): WorkbenchConfig {
  const newBlock: WorkbenchBlock = {
    id: generateBlockId(),
    type: "html-artifact",
    title,
    enabled: true,
    order: config.blocks.length,
    htmlRef,
  }
  const updated: WorkbenchConfig = {
    ...config,
    blocks: [...config.blocks, newBlock],
    lastModified: Date.now(),
  }
  saveWorkbenchConfig(updated)
  return updated
}

export function updateBlockOrder(
  config: WorkbenchConfig,
  blockIds: string[]
): WorkbenchConfig {
  const blockMap = new Map(config.blocks.map((b) => [b.id, b]))
  const reordered = blockIds
    .map((id, index) => {
      const block = blockMap.get(id)
      if (!block) return null
      return { ...block, order: index }
    })
    .filter((b): b is WorkbenchBlock => b !== null)
  const updated: WorkbenchConfig = {
    ...config,
    blocks: reordered,
    lastModified: Date.now(),
  }
  saveWorkbenchConfig(updated)
  return updated
}

export function removeBlock(
  config: WorkbenchConfig,
  blockId: string
): WorkbenchConfig {
  const reordered = config.blocks
    .filter((b) => b.id !== blockId)
    .map((b, index) => ({ ...b, order: index }))
  const updated: WorkbenchConfig = {
    ...config,
    blocks: reordered,
    lastModified: Date.now(),
  }
  saveWorkbenchConfig(updated)
  return updated
}

export function updateBlockSize(
  config: WorkbenchConfig,
  blockId: string,
  width: number,
  height: number
): WorkbenchConfig {
  const updatedBlocks = config.blocks.map((b) =>
    b.id === blockId ? { ...b, width, height } : b
  )
  const updated: WorkbenchConfig = {
    ...config,
    blocks: updatedBlocks,
    lastModified: Date.now(),
  }
  saveWorkbenchConfig(updated)
  return updated
}
```

> 删除了 `createBlocksFromSkills`、`toggleBlock`、`addCustomBlock`，以及对 `skill-block-mappings` 的依赖。`toggleBlock` 不再需要（看板没有"禁用"语义，删除即移除）；若后续 `use-workbench-config` 仍引用，在 Task 3 一并清掉。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd apps/web && pnpm test:unit src/lib/workbench/workbench-config.test.ts`
Expected: PASS（全部用例）

- [ ] **Step 5: 提交 Task 1+2**

```bash
cd "$(git rev-parse --show-toplevel)"
git add apps/web/src/types/workbench.ts apps/web/src/lib/workbench/workbench-config.ts apps/web/src/lib/workbench/workbench-config.test.ts
git commit -m "refactor(workbench): 看板数据模型改为 HTML 产物引用 + 配置增删/旧配置重置"
```

---

## Task 3: 重写 use-workbench-config hook（pinHtmlArtifact）

**Files:**
- Modify: `apps/web/src/hooks/use-workbench-config.ts`（整文件替换）

- [ ] **Step 1: 整文件替换 use-workbench-config.ts**

```typescript
import { useCallback, useState } from "react"
import type { HtmlArtifactRef, WorkbenchConfig } from "@/types/workbench"
import {
  addHtmlArtifactBlock,
  initializeWorkbenchConfig,
  loadWorkbenchConfig,
  removeBlock,
  updateBlockOrder,
  updateBlockSize,
} from "@/lib/workbench/workbench-config"

interface UseWorkbenchConfigOptions {
  /** null 时不加载（如数据未就绪）；工作台固定传 "global" */
  employeeId: string | null
}

export function useWorkbenchConfig({ employeeId }: UseWorkbenchConfigOptions) {
  const [prevEmployeeId, setPrevEmployeeId] = useState(employeeId)

  const [config, setConfig] = useState<WorkbenchConfig | null>(() => {
    if (!employeeId) return null
    return loadWorkbenchConfig(employeeId) ?? initializeWorkbenchConfig(employeeId)
  })

  if (employeeId !== prevEmployeeId) {
    setPrevEmployeeId(employeeId)
    if (!employeeId) {
      setConfig(null)
    } else {
      setConfig(
        loadWorkbenchConfig(employeeId) ?? initializeWorkbenchConfig(employeeId)
      )
    }
  }

  const refreshConfig = useCallback(() => {
    if (!employeeId) return
    setConfig(
      loadWorkbenchConfig(employeeId) ?? initializeWorkbenchConfig(employeeId)
    )
  }, [employeeId])

  const reorderBlocks = useCallback(
    (blockIds: string[]) => {
      setConfig((prev) => (prev ? updateBlockOrder(prev, blockIds) : prev))
    },
    []
  )

  const pinHtmlArtifact = useCallback(
    (htmlRef: HtmlArtifactRef, title: string) => {
      setConfig((prev) =>
        prev ? addHtmlArtifactBlock(prev, htmlRef, title) : prev
      )
    },
    []
  )

  const removeBlockById = useCallback((blockId: string) => {
    setConfig((prev) => (prev ? removeBlock(prev, blockId) : prev))
  }, [])

  const resizeBlock = useCallback(
    (blockId: string, width: number, height: number) => {
      setConfig((prev) =>
        prev ? updateBlockSize(prev, blockId, width, height) : prev
      )
    },
    []
  )

  return {
    config,
    reorderBlocks,
    pinHtmlArtifact,
    removeBlock: removeBlockById,
    resizeBlock,
    refreshConfig,
  }
}
```

> 改动：去掉 `skills` 入参与 `toggleBlockEnabled`/`addBlock`；新增 `pinHtmlArtifact`。回调改用函数式 `setConfig(prev => ...)`，去掉对 `config` 的依赖（避免闭包陈旧）。

- [ ] **Step 2: 类型检查（预期仍有 grid / view / 待删文件报错）**

Run: `cd apps/web && pnpm typecheck`
Expected: 报错仅剩 `draggable-workbench-grid.tsx`、`workbench-view.tsx`、`data-visualizer.tsx`、`add-block-dialog.tsx`、`skill-block-renderer.tsx`、`artifact-panel.tsx`（钉住入口未加）。继续 Task 4。

- [ ] **Step 3: 暂不提交**（等 Task 4 grid 改造后一起 typecheck 通过再提交）

---

## Task 4: 新增 WorkbenchHtmlPanel + 改造网格

**Files:**
- Create: `apps/web/src/components/workbench/workbench-html-panel.tsx`
- Create: `apps/web/src/components/workbench/workbench-html-panel.test.tsx`
- Modify: `apps/web/src/components/workbench/draggable-workbench-grid.tsx`

- [ ] **Step 1: 写 WorkbenchHtmlPanel 组件**

```typescript
import * as React from "react"
import { IconRefresh, IconAlertTriangle } from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { useResourceContentQuery } from "@/hooks/use-chat-queries"
import { HtmlArtifactRenderer } from "@/components/artifact/artifact-content/html-artifact-renderer"
import type { Artifact } from "@/components/artifact/artifact-types"
import type { HtmlArtifactRef } from "@/types/workbench"

interface WorkbenchHtmlPanelProps {
  htmlRef: HtmlArtifactRef
  title: string
  className?: string
}

/**
 * 工作台单看板：取总管生成的 HTML 源码 → 复用 HtmlArtifactRenderer（沙箱 iframe，
 * iframe 内 JS 自带 fetch 实时拉数据出图）。源文件缺失时渲染占位，不崩溃。
 */
export function WorkbenchHtmlPanel({
  htmlRef,
  title,
  className,
}: WorkbenchHtmlPanelProps) {
  const { data, isLoading, isError, refetch } = useResourceContentQuery(
    htmlRef.conversationId,
    htmlRef.resourcePath
  )

  const artifact: Artifact | null = React.useMemo(() => {
    if (!data?.content) return null
    return {
      id: `workbench-html:${htmlRef.resourcePath}`,
      type: "code",
      title,
      content: data.content,
      language: "html",
    }
  }, [data?.content, htmlRef.resourcePath, title])

  const missing = isError || (!isLoading && !data?.content)

  return (
    <div
      className={cn(
        "flex h-full flex-col overflow-hidden rounded-md border border-border/80 bg-card shadow-sm",
        className
      )}
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-border/50 bg-muted/35 px-2 py-1">
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
          {title}
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          className="size-5"
          title="刷新看板"
          onClick={() => void refetch()}
        >
          <IconRefresh className="size-3" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {missing ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 px-3 text-center">
            <IconAlertTriangle className="size-5 text-muted-foreground/70" />
            <p className="text-xs text-muted-foreground">
              产物已不存在或无法加载
            </p>
            <p className="text-[10px] text-muted-foreground/80">
              可移除此看板，或在总管会话重新生成
            </p>
          </div>
        ) : artifact ? (
          <HtmlArtifactRenderer artifact={artifact} className="h-full" />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            加载中…
          </div>
        )}
      </div>
    </div>
  )
}
```

> 说明：`type: "code" + language: "html"` 会被 `resolveArtifactRenderer` 命中 html 分支（实际渲染由我们直接调 `HtmlArtifactRenderer` 完成，type 仅用于满足 `Artifact` 结构）。`icon-xs` size 与 `data-visualizer` 顶栏刷新一致。

- [ ] **Step 2: 写 WorkbenchHtmlPanel 测试**

```typescript
// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"

// mock 掉重资源查询与渲染器，隔离测面板自身分支
const mockUseResourceContentQuery = vi.fn()
vi.mock("@/hooks/use-chat-queries", () => ({
  useResourceContentQuery: (...args: unknown[]) =>
    mockUseResourceContentQuery(...args),
}))
vi.mock(
  "@/components/artifact/artifact-content/html-artifact-renderer",
  () => ({
    HtmlArtifactRenderer: ({ artifact }: { artifact: { content: string } }) => (
      <div data-testid="html-renderer">{artifact.content}</div>
    ),
  })
)

import { WorkbenchHtmlPanel } from "./workbench-html-panel"

const REF = { conversationId: 1, resourcePath: "/artifacts/a.html", pinnedAt: 1 }

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("WorkbenchHtmlPanel", () => {
  it("renders the html content via HtmlArtifactRenderer", () => {
    mockUseResourceContentQuery.mockReturnValue({
      data: { content: "<h1>hi</h1>", artifact_type: "code", language: "html" },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    })
    render(<WorkbenchHtmlPanel htmlRef={REF} title="看板A" />)
    expect(screen.getByTestId("html-renderer")).toHaveTextContent("<h1>hi</h1>")
    expect(screen.getByText("看板A")).toBeInTheDocument()
  })

  it("renders missing placeholder on error", () => {
    mockUseResourceContentQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: vi.fn(),
    })
    render(<WorkbenchHtmlPanel htmlRef={REF} title="看板A" />)
    expect(screen.getByText("产物已不存在或无法加载")).toBeInTheDocument()
    expect(screen.queryByTestId("html-renderer")).toBeNull()
  })

  it("renders loading state while fetching", () => {
    mockUseResourceContentQuery.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: vi.fn(),
    })
    render(<WorkbenchHtmlPanel htmlRef={REF} title="看板A" />)
    expect(screen.getByText("加载中…")).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: 运行测试确认失败**

Run: `cd apps/web && pnpm test:unit src/components/workbench/workbench-html-panel.test.tsx`
Expected: FAIL（首次可能因 `@testing-library/react` 未安装而报模块缺失——见下步）

- [ ] **Step 4: 确认测试依赖存在**

Run: `cd apps/web && node -e "require.resolve('@testing-library/react'); require.resolve('@testing-library/jest-dom'); console.log('ok')"`

- 若打印 `ok`：跳过本步。
- 若报 `Cannot find module`：该仓库 React 组件测试尚无 testing-library。**改用更轻的断言**——把本组件测试改为只测纯逻辑（把 `missing` 判定抽成导出纯函数 `isHtmlPanelMissing(isError, isLoading, hasContent)` 并单测它），删掉 render 相关用例。在「执行记录」注明该降级。

> 期望大多数情况已装（artifact 有 `.test.tsx`）。先按 Step 2 全量测试走。

- [ ] **Step 5: 改造 draggable-workbench-grid.tsx**

替换顶部 import（删除 `SkillBlockRenderer`、`DataVisualizer`、`Card`/`CardContent` 若仅 ResizableBlock 用）：

```typescript
import { useState, useCallback } from "react"
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { IconGripVertical, IconTrash } from "@tabler/icons-react"
import { cn } from "@workspace/ui/lib/utils"
import type { WorkbenchBlock } from "@/types/workbench"
import { WorkbenchHtmlPanel } from "./workbench-html-panel"
```

替换 `DraggableWorkbenchGridProps`（删 `onToggleBlock`、`onAddTemplate`）：

```typescript
interface DraggableWorkbenchGridProps {
  blocks: WorkbenchBlock[]
  onReorder: (blockIds: string[]) => void
  onRemoveBlock?: (blockId: string) => void
  onResizeBlock?: (blockId: string, width: number, height: number) => void
}
```

替换 `SortableBlock` 内部 block 渲染区（即原 `{block.enabled ? (...) : (...)}` 整段）为下面这个可缩放 HTML 面板：

```typescript
      <ResizableHtmlBlock block={block} onResize={onResize} />
```

并把 `SortableBlock` 的 props 去掉 `onToggle`（保留 `onRemove`、`onResize`）。

新增 `ResizableHtmlBlock`（替换原 `ResizableBlock`，复用其拖拽缩放逻辑，内容换成 `WorkbenchHtmlPanel`）：

```typescript
function ResizableHtmlBlock({
  block,
  onResize,
}: {
  block: WorkbenchBlock
  onResize?: (blockId: string, width: number, height: number) => void
}) {
  const [isResizing, setIsResizing] = useState(false)
  const [size, setSize] = useState({
    width: block.width || 360,
    height: block.height || 240,
  })

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setIsResizing(true)
      const startX = e.clientX
      const startY = e.clientY
      const startWidth = size.width
      const startHeight = size.height
      let finalW = startWidth
      let finalH = startHeight
      const handleMouseMove = (moveEvent: MouseEvent) => {
        finalW = Math.max(240, startWidth + (moveEvent.clientX - startX))
        finalH = Math.max(160, startHeight + (moveEvent.clientY - startY))
        setSize({ width: finalW, height: finalH })
      }
      const handleMouseUp = () => {
        setIsResizing(false)
        document.removeEventListener("mousemove", handleMouseMove)
        document.removeEventListener("mouseup", handleMouseUp)
        if (onResize && (finalW !== block.width || finalH !== block.height)) {
          onResize(block.id, finalW, finalH)
        }
      }
      document.addEventListener("mousemove", handleMouseMove)
      document.addEventListener("mouseup", handleMouseUp)
    },
    [size.width, size.height, block.id, block.width, block.height, onResize]
  )

  return (
    <div
      className={cn(
        "group/card relative overflow-hidden rounded-md",
        "transition-[box-shadow] hover:shadow-md"
      )}
      style={{ width: size.width, height: size.height }}
    >
      <WorkbenchHtmlPanel htmlRef={block.htmlRef} title={block.title} className="h-full" />
      <div
        className={cn(
          "absolute right-0.5 bottom-0.5 flex size-5 cursor-se-resize items-end justify-end rounded-sm p-0.5 opacity-0 transition-opacity group-hover/card:opacity-100",
          isResizing && "opacity-100"
        )}
        onMouseDown={handleMouseDown}
        title="拖拽调整大小"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" className="text-muted-foreground/80" aria-hidden>
          <path d="M14 14L14 8M14 14L8 14M14 14L10 10" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" fill="none" />
        </svg>
      </div>
    </div>
  )
}
```

更新 `DraggableWorkbenchGrid` 函数签名（删 `onToggleBlock`、`onAddTemplate`），空状态文案改为引导总管生成：

```typescript
export function DraggableWorkbenchGrid({
  blocks,
  onReorder,
  onRemoveBlock,
  onResizeBlock,
}: DraggableWorkbenchGridProps) {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (over && active.id !== over.id) {
      const oldIndex = blocks.findIndex((b) => b.id === active.id)
      const newIndex = blocks.findIndex((b) => b.id === over.id)
      const newBlockIds = [...blocks.map((b) => b.id)]
      newBlockIds.splice(oldIndex, 1)
      newBlockIds.splice(newIndex, 0, active.id as string)
      onReorder(newBlockIds)
    }
  }

  if (blocks.length === 0) {
    return (
      <div
        className={cn(
          "flex w-full flex-col items-center justify-center gap-3 rounded-xl border border-dashed",
          "border-border/70 bg-muted/10 px-6 py-16",
          "min-h-[min(520px,calc(100dvh-14rem))]"
        )}
      >
        <div className="max-w-sm text-center">
          <div className="text-sm text-muted-foreground">还没有看板</div>
          <div className="mt-2 text-xs text-muted-foreground">
            在右侧让总管生成一个 HTML 看板，然后在资源面板里「钉到工作台」
          </div>
        </div>
      </div>
    )
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={blocks.map((b) => b.id)} strategy={rectSortingStrategy}>
        <div className="flex flex-wrap gap-3">
          {blocks.map((block) => (
            <SortableBlock
              key={block.id}
              block={block}
              onRemove={onRemoveBlock}
              onResize={onResizeBlock}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  )
}
```

同步把 `SortableBlock` 的 props 接口里删掉 `onToggle`，并删除其中的「已禁用」分支与原 `ResizableBlock` 函数。

- [ ] **Step 6: 运行面板测试确认通过**

Run: `cd apps/web && pnpm test:unit src/components/workbench/workbench-html-panel.test.tsx`
Expected: PASS

- [ ] **Step 7: 类型检查**

Run: `cd apps/web && pnpm typecheck`
Expected: 报错仅剩 `workbench-view.tsx`（仍引用旧 hook 返回值/AddBlockDialog）与 `data-visualizer.tsx`/`add-block-dialog.tsx`/`skill-block-renderer.tsx`（待删）。继续 Task 5。

- [ ] **Step 8: 暂不提交**（等 Task 5 view 改造后整体通过再提交）

---

## Task 5: 改造 WorkbenchView（删技能加载与 AddBlockDialog）

**Files:**
- Modify: `apps/web/src/components/chat/views/workbench-view.tsx`（整文件替换）

- [ ] **Step 1: 整文件替换 workbench-view.tsx**

```typescript
import * as React from "react"
import { IconX } from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { useWorkbenchConfig } from "@/hooks/use-workbench-config"
import { WorkbenchLeftPanel } from "@/components/workbench/workbench-left-panel"
import { DraggableWorkbenchGrid } from "@/components/workbench/draggable-workbench-grid"
import { WorkbenchContentSplit } from "@/components/workbench/workbench-content-split"

/** 单一全局工作台配置键 —— 见 workbench-config.ts localStorage 前缀 */
const GLOBAL_WORKBENCH_ID = "global"

interface WorkbenchViewProps {
  onClose?: () => void
  className?: string
}

export function WorkbenchView({ onClose, className }: WorkbenchViewProps) {
  const { config, reorderBlocks, removeBlock, resizeBlock } = useWorkbenchConfig({
    employeeId: GLOBAL_WORKBENCH_ID,
  })

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
      <div className="flex items-center justify-between border-b px-4 py-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium">工作台</h3>
        </div>
        {onClose && (
          <Button variant="ghost" size="icon-sm" onClick={onClose}>
            <IconX className="size-4" />
          </Button>
        )}
      </div>

      <div className="flex min-h-0 flex-1">
        <WorkbenchLeftPanel />
        <WorkbenchContentSplit>
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="text-xs font-medium text-muted-foreground">我的看板</div>
          </div>
          {config ? (
            <DraggableWorkbenchGrid
              blocks={config.blocks}
              onReorder={reorderBlocks}
              onRemoveBlock={removeBlock}
              onResizeBlock={resizeBlock}
            />
          ) : null}
        </WorkbenchContentSplit>
      </div>
    </div>
  )
}
```

> 删除：`useQuery`/`fetchEmployees`/`fetchSkillList`/`fetchEmployeeSkillsFromLocal`/`localEnriched`/`skills` memo/`chatEmployeeId`/`AddBlockDialog`/「添加模块」按钮/loading skeleton 分支。空状态由 grid 自身处理。

- [ ] **Step 2: 类型检查（仅剩待删文件报错）**

Run: `cd apps/web && pnpm typecheck`
Expected: 报错仅来自 `data-visualizer.tsx`、`add-block-dialog.tsx`、`skill-block-renderer.tsx` 及它们依赖的 lib（这些下一步删）。

- [ ] **Step 3: 提交 Task 3+4+5**

```bash
cd "$(git rev-parse --show-toplevel)"
git add apps/web/src/hooks/use-workbench-config.ts apps/web/src/components/workbench/workbench-html-panel.tsx apps/web/src/components/workbench/workbench-html-panel.test.tsx apps/web/src/components/workbench/draggable-workbench-grid.tsx apps/web/src/components/chat/views/workbench-view.tsx
git commit -m "refactor(workbench): 网格渲染 HTML 看板面板 + view 去技能加载"
```

---

## Task 6: 删除旧接口解析与图表渲染管道

**Files:**
- Delete: 见下方清单

- [ ] **Step 1: 删除文件**

```bash
cd apps/web/src
rm components/workbench/add-block-dialog.tsx
rm components/workbench/data-visualizer.tsx
rm components/workbench/skill-block-renderer.tsx
rm lib/workbench/query-interface-parser.ts
rm lib/workbench/query-interface-resolve.ts
rm lib/workbench/response-field-analyzer.ts
rm lib/workbench/parse-response-rows.ts
rm lib/workbench/ai-extract-headers.ts
rm lib/workbench/http-headers.ts
rm lib/workbench/skill-url-extract.ts
rm lib/workbench/url-template-params.ts
rm lib/workbench/skill-block-mappings.ts
rm lib/workbench/skill-interfaces-cache.ts
rm lib/workbench/chat-send-employee.ts
rm lib/workbench/local-skill-loader.ts
```

- [ ] **Step 2: 搜索残留引用**

Run: `cd apps/web && grep -rEl "data-visualizer|add-block-dialog|skill-block-renderer|query-interface-parser|query-interface-resolve|response-field-analyzer|parse-response-rows|ai-extract-headers|workbench/http-headers|skill-url-extract|url-template-params|skill-block-mappings|skill-interfaces-cache|chat-send-employee|local-skill-loader" src/ || echo "NO RESIDUAL REFERENCES"`
Expected: 打印 `NO RESIDUAL REFERENCES`（若有命中，逐个清理；预期均已在前序任务移除）

- [ ] **Step 3: 类型检查全绿**

Run: `cd apps/web && pnpm typecheck`
Expected: PASS（无报错）

- [ ] **Step 4: 跑全部工作台相关测试**

Run: `cd apps/web && pnpm test:unit src/components/workbench src/lib/workbench`
Expected: PASS（`workbench-config`、`workbench-html-panel`、`resolve-workbench-curator-panel` 全过）

- [ ] **Step 5: 提交**

```bash
cd "$(git rev-parse --show-toplevel)"
git add -A
git commit -m "refactor(workbench): 删除旧接口解析与固定图表渲染整套管道"
```

---

## Task 7: 资源面板「钉到工作台」入口

**Files:**
- Modify: `apps/web/src/components/artifact/artifact-panel.tsx`

> 在 `.html` 文件的右键菜单（`ResourceContextMenu`）加一项「钉到工作台」。需要 `conversationId`（组件已有）、`entry.path`、`entry.name`。

- [ ] **Step 1: 在 artifact-panel.tsx 顶部加导入**

在现有 import 区加：

```typescript
import { IconPin } from "@tabler/icons-react"
import { addHtmlArtifactBlock, loadWorkbenchConfig, initializeWorkbenchConfig } from "@/lib/workbench/workbench-config"
import { isHtmlPath } from "./artifact-content/resolve-renderer"
```

> `IconPin` 加进已有的 `@tabler/icons-react` 解构导入即可（不要重复 import 行）。

- [ ] **Step 2: 加一个钉住工具函数（文件内、组件外）**

```typescript
const WORKBENCH_ID = "global"

/** 把某会话的 HTML 产物钉成工作台看板（直接读写 localStorage，工作台下次打开即生效） */
function pinHtmlToWorkbench(
  conversationId: string | number,
  path: string,
  name: string
) {
  const config =
    loadWorkbenchConfig(WORKBENCH_ID) ?? initializeWorkbenchConfig(WORKBENCH_ID)
  const title = name.replace(/\.html?$/i, "")
  addHtmlArtifactBlock(
    config,
    { conversationId, resourcePath: path, pinnedAt: Date.now() },
    title
  )
}
```

> 设计取舍：工作台与资源面板分处不同视图，没有共享的 React state。钉住直接写 localStorage，工作台 `useWorkbenchConfig` 在下次挂载/`refreshConfig` 时读取。本期不做跨视图实时推送（YAGNI）。

- [ ] **Step 3: 在 ResourceContextMenu 加「钉到工作台」项**

修改 `ResourceContextMenu` 组件，新增可选回调与菜单项。先扩展其 props：

```typescript
function ResourceContextMenu({
  entry,
  conversationId,
  onDelete,
  onRefresh,
  onPin,
  pendingOnly = false,
}: {
  entry: ResourceEntry
  conversationId: string | number
  onDelete: (entry: ResourceEntry) => void
  onRefresh: () => void
  onPin?: (entry: ResourceEntry) => void
  pendingOnly?: boolean
}) {
```

在 `<ContextMenuContent>` 内、`下载` 项之后插入（仅 `.html` 且非 pending 时显示）：

```typescript
      {!pendingOnly && onPin && isHtmlPath(entry.path) && (
        <ContextMenuItem onSelect={() => onPin(entry)}>
          <IconPin className="size-4 text-muted-foreground" />
          <span>钉到工作台</span>
        </ContextMenuItem>
      )}
```

- [ ] **Step 4: 在 renderEntry 透传 onPin，并在 ArtifactPanel 提供 handler**

`renderEntry` 增加参数 `onPin` 并透传给文件项的 `ResourceContextMenu`（与 `onDelete`/`onRefresh` 同样方式）。在 `ArtifactPanel` 内定义：

```typescript
  const handlePin = React.useCallback(
    (entry: ResourceEntry) => {
      if (!conversationId) return
      pinHtmlToWorkbench(conversationId, entry.path, entry.name)
      toast.success(`已钉到工作台：${entry.name.replace(/\.html?$/i, "")}`)
    },
    [conversationId]
  )
```

并把 `handlePin` 一路透传到所有调用 `renderEntry(...)` 的地方（artifacts / workspace / public 等树），作为新增末位参数。

> 注意：`renderEntry` 当前签名是 `(entry, conversationId, onDelete, onRefresh, getPendingForPath)`。新增 `onPin` 加在 `getPendingForPath` 之后，更新**所有** `renderEntry(` 调用点（用 grep 找全：`grep -n "renderEntry(" src/components/artifact/artifact-panel.tsx`）。

- [ ] **Step 5: 类型检查**

Run: `cd apps/web && pnpm typecheck`
Expected: PASS

- [ ] **Step 6: lint + format**

Run: `cd apps/web && pnpm lint && pnpm format`
Expected: 无 error

- [ ] **Step 7: 提交**

```bash
cd "$(git rev-parse --show-toplevel)"
git add apps/web/src/components/artifact/artifact-panel.tsx
git commit -m "feat(workbench): 资源面板 .html 文件「钉到工作台」入口"
```

---

## Task 8: 端到端手动验证

**Files:** 无

- [ ] **Step 1: 启动应用**

Run: `cd apps/web && pnpm dev:app`

- [ ] **Step 2: 验证完整链路**

1. 打开工作台 → 中间区显示空状态「还没有看板」。
2. 右侧总管对话生成一个含图表的 HTML（如让它"做一个销售数据饼图看板，数据从 <内网接口> 实时拉"）。
3. 资源面板 → 右键该 `.html` → 「钉到工作台」→ toast 成功。
4. 工作台中间区出现该看板，沙箱 iframe 内图表正常渲染、数据为实时（对应 Task 0 验证结论）。
5. 拖拽排序、缩放、删除均生效；刷新应用后看板仍在（localStorage 持久化）。
6. 删除源 HTML 文件后刷新工作台 → 该面板显示「产物已不存在」占位、不崩溃。

- [ ] **Step 3: 记录结果到「执行记录」**

---

## 执行记录

- **⚠️ typecheck 命令更正**：`pnpm typecheck` 跑的是 `tsc --noEmit`，但根/`apps/web` 的 tsconfig 都是 solution-style（`files:[]`+references），所以**它实际什么都不检查、永远绿**。真正类型检查须用 `cd apps/web && npx tsc --build`（`tsc -b`）。注意 `--build` 会暴露大量预存在的、与本次无关的仓库错误，所以验证方式＝build 后 grep 目标文件名，确认没有**新**错误指向我们改的文件，而非要求整体 build 全绿。
- Task 0 沙箱 fetch 结论：**待用户在真实 Electron app + 真实内网接口验证**（代码实现不依赖此结论；若被 CORS 挡需另补代理层）。
- Task 4 testing-library 是否可用：`@testing-library/react` 可用；`@testing-library/jest-dom` **缺失**，故测试改用纯 vitest 匹配器（`.toBeTruthy()`/`.toBeNull()`/`.textContent`），与仓库既有 `.tsx` 测试一致。
- 代码任务 1-7 全部完成并通过两段评审（spec + 质量）。新增/改动测试全绿（workbench-config 7 例、workbench-html-panel 3 例）。
- **已知预存在问题（非本次引入）**：`resolve-workbench-curator-panel.test.ts` 有 1 个测试失败 + 3 个 tsc 类型告警，该文件本次未触碰（上次改动在 refactor 之前的 commit 6beb561），与本重构无关。
- 端到端验证结果：**待用户手动验证**（Task 8，需真实 app）。

---

## Self-Review 覆盖核对

- 数据模型（HtmlArtifactRef/WorkbenchBlock）→ Task 1 ✅
- 旧配置检测重置 → Task 2（`loadWorkbenchConfig` + 测试）✅
- 初始为空、不从技能创建 → Task 2 `initializeWorkbenchConfig` ✅
- pinHtmlArtifact / hook 改造 → Task 3 ✅
- WorkbenchHtmlPanel + 实时 fetch（iframe 内）+ 缺失占位 + 刷新 → Task 4 ✅
- 网格复用 + 空状态引导文案 → Task 4 ✅
- view 去技能加载/去 AddBlockDialog → Task 5 ✅
- 删除整套旧管道 + 残留引用检查 → Task 6 ✅
- 钉住入口（仅资源面板 .html）→ Task 7 ✅
- 前置验证（沙箱 fetch）→ Task 0 ✅
- 保留左栏/performance/总管布局 → 这些文件不在任何删除/改造步骤中，默认不动 ✅
