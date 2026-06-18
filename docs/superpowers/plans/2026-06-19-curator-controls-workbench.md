# 总管直接操控工作台 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让总管在工作台页面内通过对话直接钉/编排看板（自动钉、改尺寸、移位、改标题、隐藏、删除、重排），并把工作台布局从「任意像素」升级为飞书风格的「规格化网格」。

**Architecture:** 顺仓库现有「服务端 `@tool` 回吐结构化结果 → SSE → 前端按 toolName 分类成 block → render-map 渲染卡片」模式。新增服务端 `arrange_workbench` 工具（只校验+归一化指令，不改数据，因 config 在浏览器 localStorage），前端把该工具结果分类成 `workbench-arrange` block，由一个卡片组件在 `useEffect` 里**事务性**应用到工作台 config 并 `emitWorkbenchConfigChanged()`。网格用 `react-grid-layout` 承载 `{x,y,w,h}`。

**Tech Stack:** Python（FastAPI + langchain `@tool`）、React 19 + TypeScript、`react-grid-layout`、Vitest、pytest。

参考设计：`docs/superpowers/specs/2026-06-19-curator-controls-workbench-design.md`

---

## 文件结构总览

**服务端**
- 新增 `apps/server/src/service/agent/orchestrator/tools/workbench.py` — `arrange_workbench` 工具：解析/校验/归一化 operations。
- 改 `apps/server/src/service/agent/orchestrator/tools/__init__.py` — re-export。
- 改 `apps/server/src/service/agent/orchestrator/agent.py` — 注册工具 + system prompt 注入工作台编排约定。
- 新增 `apps/server/tests/test_workbench_tool.py`。

**前端 · 数据层**
- 改 `apps/web/src/types/workbench.ts` — `WorkbenchBlock` 删像素字段、加 `gridSpan`/`gridPos`；新增 `GridSpan`/`GridPos`/`GridSpanPreset`/`WorkbenchArrangeOp`。
- 改 `apps/web/src/lib/workbench/workbench-config.ts` — `addHtmlArtifactBlock` 支持 span/pos + 自动寻空位；新增 `setBlockSpan`/`setBlockPos`/`setBlockTitle`/`setBlockEnabled`；`applyArrangeOperations`（事务性）；`isValidConfig` 校验网格字段；`SPAN_PRESETS` 映射。
- 新增 `apps/web/src/lib/workbench/grid.ts` — 网格常量（列数/行高）+ 自动寻空位算法。

**前端 · 工具通道**
- 新增 `apps/web/src/lib/chat/tools/handlers/workbench-arrange.ts` — handler，分类成 `workbench-arrange` block。
- 改 `apps/web/src/lib/chat/tools/block-registry.ts` — 注册 handler。
- 改 `apps/web/src/lib/chat/message-classifier.ts`（或 ClassifiedBlock 类型所在文件）— 加 `workbench-arrange` block 类型。
- 新增 `apps/web/src/components/chat/message-blocks/workbench-arrange-card.tsx` — 卡片组件，`useEffect` 事务应用 + 显示摘要。
- 改 `apps/web/src/components/chat/message-blocks/block-render-map.tsx` — 渲染该 block。

**前端 · 网格渲染 & 上下文注入**
- 改 `apps/web/src/components/workbench/draggable-workbench-grid.tsx` — 改用 `react-grid-layout`。
- 改 `apps/web/src/hooks/use-workbench-config.ts` — `resizeBlock` 改网格语义、暴露 `config` 供注入读取。
- 改 `apps/web/src/components/workbench/workbench-content-split.tsx` — 看板清单作为隐藏上下文注入总管对话。

---

## Task 1: 网格常量与寻空位算法（纯函数，先打地基）

**Files:**
- Create: `apps/web/src/lib/workbench/grid.ts`
- Test: `apps/web/src/lib/workbench/grid.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// apps/web/src/lib/workbench/grid.test.ts
import { describe, it, expect } from "vitest"
import { GRID_COLS, SPAN_PRESETS, findFreeSlot } from "./grid"

describe("grid constants", () => {
  it("12 列网格", () => {
    expect(GRID_COLS).toBe(12)
  })
  it("四档 span 预设", () => {
    expect(SPAN_PRESETS.small).toEqual({ w: 3, h: 2 })
    expect(SPAN_PRESETS.medium).toEqual({ w: 6, h: 3 })
    expect(SPAN_PRESETS.large).toEqual({ w: 6, h: 6 })
    expect(SPAN_PRESETS.full).toEqual({ w: 12, h: 6 })
  })
})

describe("findFreeSlot", () => {
  it("空网格放左上角", () => {
    expect(findFreeSlot([], { w: 6, h: 3 })).toEqual({ x: 0, y: 0 })
  })
  it("第一格已占 6 宽时，同宽新块落右侧", () => {
    const occupied = [{ x: 0, y: 0, w: 6, h: 3 }]
    expect(findFreeSlot(occupied, { w: 6, h: 3 })).toEqual({ x: 6, y: 0 })
  })
  it("一行放不下时换行", () => {
    const occupied = [
      { x: 0, y: 0, w: 6, h: 3 },
      { x: 6, y: 0, w: 6, h: 3 },
    ]
    expect(findFreeSlot(occupied, { w: 6, h: 3 })).toEqual({ x: 0, y: 3 })
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter web test -- src/lib/workbench/grid.test.ts`
Expected: FAIL（`grid.ts` 不存在 / 导出未定义）

- [ ] **Step 3: 实现**

```ts
// apps/web/src/lib/workbench/grid.ts
import type { GridSpan, GridPos, GridSpanPreset } from "@/types/workbench"

/** 网格列数（飞书风格 12 列）。 */
export const GRID_COLS = 12

/** 行高（像素），react-grid-layout 的 rowHeight。 */
export const GRID_ROW_HEIGHT = 120

/** 四档标准尺寸：列数 w × 行数 h。 */
export const SPAN_PRESETS: Record<GridSpanPreset, GridSpan> = {
  small: { w: 3, h: 2 },
  medium: { w: 6, h: 3 },
  large: { w: 6, h: 6 },
  full: { w: 12, h: 6 },
}

interface OccupiedRect {
  x: number
  y: number
  w: number
  h: number
}

function overlaps(a: OccupiedRect, b: OccupiedRect): boolean {
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  )
}

/**
 * 在 12 列网格里为一个 span 找第一个不与已占块重叠的左上角位置。
 * 逐行（y 从 0 递增）、逐列（x 从 0 到 GRID_COLS-w）扫描，返回首个空位。
 */
export function findFreeSlot(
  occupied: OccupiedRect[],
  span: GridSpan
): GridPos {
  const maxX = GRID_COLS - span.w
  for (let y = 0; y < 1000; y++) {
    for (let x = 0; x <= maxX; x++) {
      const candidate = { x, y, w: span.w, h: span.h }
      if (!occupied.some((o) => overlaps(o, candidate))) {
        return { x, y }
      }
    }
  }
  return { x: 0, y: 0 }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter web test -- src/lib/workbench/grid.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/lib/workbench/grid.ts apps/web/src/lib/workbench/grid.test.ts
git commit -m "feat(workbench): 网格常量与寻空位算法"
```

---

## Task 2: 数据模型——网格字段类型

**Files:**
- Modify: `apps/web/src/types/workbench.ts`

- [ ] **Step 1: 改类型定义**

把 `WorkbenchBlock` 的像素字段换成网格字段，新增网格相关类型。完整替换文件中 `HtmlArtifactRef` 之后的内容为：

```ts
/** 看板尺寸档位。 */
export type GridSpanPreset = "small" | "medium" | "large" | "full"

/** 看板占据的网格跨度：w 列数、h 行数。 */
export interface GridSpan {
  w: number
  h: number
}

/** 看板左上角的网格坐标：x 起始列、y 起始行。 */
export interface GridPos {
  x: number
  y: number
}

/**
 * 工作台看板块：唯一类型为总管生成的 HTML 产物引用。
 * 布局采用规格化网格（gridSpan/gridPos），不再用像素 width/height。
 */
export interface WorkbenchBlock {
  id: string
  type: "html-artifact"
  title: string
  enabled: boolean
  order: number
  htmlRef: HtmlArtifactRef
  /** 网格跨度（列数/行数）。 */
  gridSpan: GridSpan
  /** 网格位置（起始列/行）。 */
  gridPos: GridPos
}

export interface WorkbenchConfig {
  employeeId: string
  blocks: WorkbenchBlock[]
  lastModified: number
}

/**
 * 总管 arrange_workbench 工具回吐的单条归一化指令。
 * 服务端已校验路径存在并把 span 档位归一化为具体 {w,h}。
 */
export type WorkbenchArrangeOp =
  | { op: "pin"; resourcePath: string; title?: string; span?: GridSpan; pos?: GridPos }
  | { op: "resize"; blockRef: string; span: GridSpan }
  | { op: "move"; blockRef: string; pos: GridPos }
  | { op: "rename"; blockRef: string; title: string }
  | { op: "hide"; blockRef: string }
  | { op: "remove"; blockRef: string }
  | { op: "reorder"; order: string[] }

/** 任务状态（task-status-badge / today-task-list 用，保留）。 */
export type TaskStatus =
  | "success"
  | "failed"
  | "pending"
  | "running"
  | "timeout"
  | "stuck"
  | "cancelled"
```

- [ ] **Step 2: typecheck（预期别处报错——下一步修）**

Run: `pnpm --filter web typecheck`
Expected: FAIL，报 `workbench-config.ts` / `draggable-workbench-grid.tsx` / `use-workbench-config.ts` 等引用了已删的 `width`/`height`。这是预期的，Task 3-7 会逐个修好。

- [ ] **Step 3: 提交**

```bash
git add apps/web/src/types/workbench.ts
git commit -m "feat(workbench): 看板数据模型改为规格化网格字段"
```

---

## Task 3: config 层——网格操作与事务应用

**Files:**
- Modify: `apps/web/src/lib/workbench/workbench-config.ts`
- Test: `apps/web/src/lib/workbench/workbench-config.test.ts`

- [ ] **Step 1: 写失败测试**（追加到现有测试文件）

```ts
// apps/web/src/lib/workbench/workbench-config.test.ts —— 追加
import {
  setBlockSpan,
  setBlockPos,
  setBlockTitle,
  setBlockEnabled,
  applyArrangeOperations,
} from "./workbench-config"
import type { WorkbenchConfig, WorkbenchArrangeOp } from "@/types/workbench"

function emptyConfig(): WorkbenchConfig {
  return { employeeId: "global", blocks: [], lastModified: 0 }
}

describe("网格 config 操作", () => {
  it("addHtmlArtifactBlock 默认中档 + 自动落左上", () => {
    const cfg = addHtmlArtifactBlock(
      emptyConfig(),
      { conversationId: 1, resourcePath: "/artifacts/a.html", pinnedAt: 0 },
      "看板A"
    )
    expect(cfg.blocks).toHaveLength(1)
    expect(cfg.blocks[0].gridSpan).toEqual({ w: 6, h: 3 })
    expect(cfg.blocks[0].gridPos).toEqual({ x: 0, y: 0 })
  })

  it("setBlockSpan 改尺寸", () => {
    let cfg = addHtmlArtifactBlock(
      emptyConfig(),
      { conversationId: 1, resourcePath: "/artifacts/a.html", pinnedAt: 0 },
      "A"
    )
    const id = cfg.blocks[0].id
    cfg = setBlockSpan(cfg, id, { w: 12, h: 6 })
    expect(cfg.blocks[0].gridSpan).toEqual({ w: 12, h: 6 })
  })

  it("旧像素 config（无 gridSpan）加载时判为非法", () => {
    const legacy = {
      employeeId: "global",
      lastModified: 0,
      blocks: [
        { id: "x", type: "html-artifact", title: "t", enabled: true, order: 0,
          htmlRef: { conversationId: 1, resourcePath: "/artifacts/a.html", pinnedAt: 0 },
          width: 360, height: 240 },
      ],
    }
    localStorage.setItem("workbench-config-global", JSON.stringify(legacy))
    expect(loadWorkbenchConfig("global")).toBeNull()
  })
})

describe("applyArrangeOperations 事务性", () => {
  it("pin + resize 一批应用", () => {
    const ops: WorkbenchArrangeOp[] = [
      { op: "pin", resourcePath: "/artifacts/sales.html", title: "销售", span: { w: 6, h: 6 } },
    ]
    const cfg = applyArrangeOperations(emptyConfig(), ops, 1)
    expect(cfg.blocks).toHaveLength(1)
    expect(cfg.blocks[0].title).toBe("销售")
    expect(cfg.blocks[0].gridSpan).toEqual({ w: 6, h: 6 })
  })

  it("blockRef 找不到的 resize 被跳过，不影响其余 op", () => {
    let cfg = addHtmlArtifactBlock(
      emptyConfig(),
      { conversationId: 1, resourcePath: "/artifacts/a.html", pinnedAt: 0 },
      "A"
    )
    const ops: WorkbenchArrangeOp[] = [
      { op: "resize", blockRef: "不存在", span: { w: 12, h: 6 } },
      { op: "rename", blockRef: "A", title: "A2" },
    ]
    cfg = applyArrangeOperations(cfg, ops, 1)
    expect(cfg.blocks[0].title).toBe("A2") // 第二条仍生效
    expect(cfg.blocks[0].gridSpan).toEqual({ w: 6, h: 3 }) // 第一条被跳过
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter web test -- src/lib/workbench/workbench-config.test.ts`
Expected: FAIL（新函数未定义 + `addHtmlArtifactBlock` 还没产出 gridSpan）

- [ ] **Step 3: 实现**

改 `workbench-config.ts`：
1. 顶部 import：`import { SPAN_PRESETS, findFreeSlot } from "./grid"`，类型加 `GridSpan, GridPos, WorkbenchArrangeOp`。
2. `isValidConfig` 的 every 谓词加网格字段校验（块必须有合法 gridSpan/gridPos）：

```ts
return cfg.blocks.every(
  (b) =>
    b &&
    typeof b === "object" &&
    (b as WorkbenchBlock).type === "html-artifact" &&
    !!(b as WorkbenchBlock).htmlRef &&
    typeof (b as WorkbenchBlock).htmlRef.resourcePath === "string" &&
    !!(b as WorkbenchBlock).gridSpan &&
    typeof (b as WorkbenchBlock).gridSpan.w === "number" &&
    !!(b as WorkbenchBlock).gridPos &&
    typeof (b as WorkbenchBlock).gridPos.x === "number"
)
```

3. `addHtmlArtifactBlock` 签名加可选 `span`/`pos`，新增块带网格字段：

```ts
export function addHtmlArtifactBlock(
  config: WorkbenchConfig,
  htmlRef: HtmlArtifactRef,
  title: string,
  span: GridSpan = SPAN_PRESETS.medium,
  pos?: GridPos
): WorkbenchConfig {
  const existing = config.blocks.find(
    (b) => b.type === "html-artifact" && isSameHtmlRef(b.htmlRef, htmlRef)
  )
  if (existing) {
    const updated: WorkbenchConfig = {
      ...config,
      blocks: config.blocks.map((b) =>
        b.id === existing.id ? { ...b, title, htmlRef } : b
      ),
      lastModified: Date.now(),
    }
    saveWorkbenchConfig(updated)
    return updated
  }
  const occupied = config.blocks.map((b) => ({ ...b.gridPos, ...b.gridSpan }))
  const resolvedPos = pos ?? findFreeSlot(occupied, span)
  const newBlock: WorkbenchBlock = {
    id: generateBlockId(),
    type: "html-artifact",
    title,
    enabled: true,
    order: config.blocks.length,
    htmlRef,
    gridSpan: span,
    gridPos: resolvedPos,
  }
  const updated: WorkbenchConfig = {
    ...config,
    blocks: [...config.blocks, newBlock],
    lastModified: Date.now(),
  }
  saveWorkbenchConfig(updated)
  return updated
}
```

4. 删除旧的 `updateBlockSize`，新增网格 setter（注意：这些 setter 内部**不 save**，供 `applyArrangeOperations` 事务复用；单独调用方负责 save——但为兼容现有 `use-workbench-config` 直接调用，保留 save 版。统一做法见下）：

```ts
/** 改尺寸（保存）。 */
export function setBlockSpan(
  config: WorkbenchConfig,
  blockId: string,
  span: GridSpan
): WorkbenchConfig {
  const blocks = config.blocks.map((b) =>
    b.id === blockId ? { ...b, gridSpan: span } : b
  )
  const updated = { ...config, blocks, lastModified: Date.now() }
  saveWorkbenchConfig(updated)
  return updated
}

/** 改位置（保存）。 */
export function setBlockPos(
  config: WorkbenchConfig,
  blockId: string,
  pos: GridPos
): WorkbenchConfig {
  const blocks = config.blocks.map((b) =>
    b.id === blockId ? { ...b, gridPos: pos } : b
  )
  const updated = { ...config, blocks, lastModified: Date.now() }
  saveWorkbenchConfig(updated)
  return updated
}

/** 改标题（保存）。 */
export function setBlockTitle(
  config: WorkbenchConfig,
  blockId: string,
  title: string
): WorkbenchConfig {
  const blocks = config.blocks.map((b) =>
    b.id === blockId ? { ...b, title } : b
  )
  const updated = { ...config, blocks, lastModified: Date.now() }
  saveWorkbenchConfig(updated)
  return updated
}

/** 显隐（保存）。 */
export function setBlockEnabled(
  config: WorkbenchConfig,
  blockId: string,
  enabled: boolean
): WorkbenchConfig {
  const blocks = config.blocks.map((b) =>
    b.id === blockId ? { ...b, enabled } : b
  )
  const updated = { ...config, blocks, lastModified: Date.now() }
  saveWorkbenchConfig(updated)
  return updated
}
```

5. 事务应用——在内存里基于纯函数累积出新 config，最后一次性 save：

```ts
/** 把 blockRef（标题或 1 基序号）解析为 blockId；找不到返回 null。 */
function resolveBlockRef(
  config: WorkbenchConfig,
  ref: string
): string | null {
  const byTitle = config.blocks.find((b) => b.title === ref)
  if (byTitle) return byTitle.id
  const idx = Number(ref)
  if (Number.isInteger(idx) && idx >= 1 && idx <= config.blocks.length) {
    return config.blocks[idx - 1].id
  }
  return null
}

/**
 * 事务性应用一批归一化 arrange 指令：在内存里逐条算出新 config，
 * 全部处理完一次性 save。blockRef 找不到的条目跳过（记入返回的 skipped）。
 * conversationId 用于 pin 指令构造 htmlRef。
 */
export function applyArrangeOperations(
  config: WorkbenchConfig,
  ops: WorkbenchArrangeOp[],
  conversationId: string | number
): WorkbenchConfig {
  let next: WorkbenchConfig = { ...config, blocks: [...config.blocks] }

  for (const op of ops) {
    switch (op.op) {
      case "pin": {
        // 复用 add 逻辑但避免重复 save：手工内联
        next = addBlockInMemory(next, {
          htmlRef: { conversationId, resourcePath: op.resourcePath, pinnedAt: Date.now() },
          title: op.title ?? op.resourcePath.split("/").pop()!.replace(/\.html?$/i, ""),
          span: op.span ?? SPAN_PRESETS.medium,
          pos: op.pos,
        })
        break
      }
      case "resize": {
        const id = resolveBlockRef(next, op.blockRef)
        if (id) next = mapBlock(next, id, (b) => ({ ...b, gridSpan: op.span }))
        break
      }
      case "move": {
        const id = resolveBlockRef(next, op.blockRef)
        if (id) next = mapBlock(next, id, (b) => ({ ...b, gridPos: op.pos }))
        break
      }
      case "rename": {
        const id = resolveBlockRef(next, op.blockRef)
        if (id) next = mapBlock(next, id, (b) => ({ ...b, title: op.title }))
        break
      }
      case "hide": {
        const id = resolveBlockRef(next, op.blockRef)
        if (id) next = mapBlock(next, id, (b) => ({ ...b, enabled: false }))
        break
      }
      case "remove": {
        const id = resolveBlockRef(next, op.blockRef)
        if (id) {
          next = {
            ...next,
            blocks: next.blocks
              .filter((b) => b.id !== id)
              .map((b, i) => ({ ...b, order: i })),
          }
        }
        break
      }
      case "reorder": {
        const ids = op.order
          .map((ref) => resolveBlockRef(next, ref))
          .filter((x): x is string => x !== null)
        const map = new Map(next.blocks.map((b) => [b.id, b]))
        const reordered = ids
          .map((id, i) => {
            const b = map.get(id)
            return b ? { ...b, order: i } : null
          })
          .filter((b): b is WorkbenchBlock => b !== null)
        // 补上未在 order 里出现的块，接在后面
        const seen = new Set(ids)
        const rest = next.blocks.filter((b) => !seen.has(b.id))
        next = {
          ...next,
          blocks: [...reordered, ...rest].map((b, i) => ({ ...b, order: i })),
        }
        break
      }
    }
  }
  const result = { ...next, lastModified: Date.now() }
  saveWorkbenchConfig(result)
  return result
}
// 注：errors（blockRef 跳过）当前不外传；如需在卡片上提示，可改返回 {config, skipped}。

/** 内存版加块（不 save），供事务复用。 */
function addBlockInMemory(
  config: WorkbenchConfig,
  args: { htmlRef: HtmlArtifactRef; title: string; span: GridSpan; pos?: GridPos }
): WorkbenchConfig {
  const existing = config.blocks.find(
    (b) => b.type === "html-artifact" && isSameHtmlRef(b.htmlRef, args.htmlRef)
  )
  if (existing) {
    return {
      ...config,
      blocks: config.blocks.map((b) =>
        b.id === existing.id ? { ...b, title: args.title, htmlRef: args.htmlRef } : b
      ),
    }
  }
  const occupied = config.blocks.map((b) => ({ ...b.gridPos, ...b.gridSpan }))
  const pos = args.pos ?? findFreeSlot(occupied, args.span)
  const newBlock: WorkbenchBlock = {
    id: generateBlockId(),
    type: "html-artifact",
    title: args.title,
    enabled: true,
    order: config.blocks.length,
    htmlRef: args.htmlRef,
    gridSpan: args.span,
    gridPos: pos,
  }
  return { ...config, blocks: [...config.blocks, newBlock] }
}

/** 内存版改块（不 save）。 */
function mapBlock(
  config: WorkbenchConfig,
  blockId: string,
  fn: (b: WorkbenchBlock) => WorkbenchBlock
): WorkbenchConfig {
  return {
    ...config,
    blocks: config.blocks.map((b) => (b.id === blockId ? fn(b) : b)),
  }
}
```

> 注：删掉 Step 3 草稿里没用上的 `noSave` 占位行。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter web test -- src/lib/workbench/workbench-config.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/lib/workbench/workbench-config.ts apps/web/src/lib/workbench/workbench-config.test.ts
git commit -m "feat(workbench): config 层网格操作与事务应用 applyArrangeOperations"
```

---

## Task 4: useWorkbenchConfig 改网格语义

**Files:**
- Modify: `apps/web/src/hooks/use-workbench-config.ts`

- [ ] **Step 1: 改 hook**

把 `resizeBlock(width, height)` 换成网格语义，import 改用新 setter：

```ts
import {
  initializeWorkbenchConfig,
  loadWorkbenchConfig,
  removeBlock,
  updateBlockOrder,
  setBlockSpan,
  setBlockPos,
  WORKBENCH_CONFIG_CHANGED_EVENT,
} from "@/lib/workbench/workbench-config"
import type { GridSpan, GridPos } from "@/types/workbench"
```

替换 `resizeBlock` 为：

```ts
const resizeBlock = useCallback((blockId: string, span: GridSpan) => {
  setConfig((prev) => (prev ? setBlockSpan(prev, blockId, span) : prev))
}, [])

const moveBlock = useCallback((blockId: string, pos: GridPos) => {
  setConfig((prev) => (prev ? setBlockPos(prev, blockId, pos) : prev))
}, [])
```

return 里加 `moveBlock`，`resizeBlock` 保留（新签名）。

- [ ] **Step 2: typecheck（此文件应通过；grid 组件仍会报，下一 Task 修）**

Run: `pnpm --filter web typecheck`
Expected: `use-workbench-config.ts` 不再报错；`draggable-workbench-grid.tsx` 仍报（Task 5 修）。

- [ ] **Step 3: 提交**

```bash
git add apps/web/src/hooks/use-workbench-config.ts
git commit -m "feat(workbench): useWorkbenchConfig 改网格 span/pos 语义"
```

---

## Task 5: 网格渲染改用 react-grid-layout

**Files:**
- Modify: `apps/web/src/components/workbench/draggable-workbench-grid.tsx`
- Modify: `apps/web/package.json`（加依赖）

- [ ] **Step 1: 装依赖**

Run:
```bash
pnpm --filter web add react-grid-layout
pnpm --filter web add -D @types/react-grid-layout
```
Expected: 写入 `apps/web/package.json`，安装成功。

- [ ] **Step 2: 重写组件**

完整替换 `draggable-workbench-grid.tsx`：

```tsx
import { useMemo } from "react"
import GridLayout, { type Layout } from "react-grid-layout"
import { IconTrash } from "@tabler/icons-react"
import { cn } from "@workspace/ui/lib/utils"
import type { GridSpan, GridPos, WorkbenchBlock } from "@/types/workbench"
import { GRID_COLS, GRID_ROW_HEIGHT } from "@/lib/workbench/grid"
import { WorkbenchHtmlPanel } from "./workbench-html-panel"
import "react-grid-layout/css/styles.css"
import "react-resizable/css/styles.css"

interface DraggableWorkbenchGridProps {
  blocks: WorkbenchBlock[]
  width: number
  onMoveResize: (blockId: string, pos: GridPos, span: GridSpan) => void
  onRemoveBlock?: (blockId: string) => void
}

export function DraggableWorkbenchGrid({
  blocks,
  width,
  onMoveResize,
  onRemoveBlock,
}: DraggableWorkbenchGridProps) {
  const visible = useMemo(() => blocks.filter((b) => b.enabled), [blocks])

  const layout: Layout[] = useMemo(
    () =>
      visible.map((b) => ({
        i: b.id,
        x: b.gridPos.x,
        y: b.gridPos.y,
        w: b.gridSpan.w,
        h: b.gridSpan.h,
        minW: 2,
        minH: 2,
      })),
    [visible]
  )

  if (visible.length === 0) {
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
            在右侧直接让总管「做一个看板」，它会自动钉到工作台并排好版
          </div>
        </div>
      </div>
    )
  }

  const handleLayoutChange = (next: Layout[]) => {
    for (const item of next) {
      const block = visible.find((b) => b.id === item.i)
      if (!block) continue
      const moved = block.gridPos.x !== item.x || block.gridPos.y !== item.y
      const resized = block.gridSpan.w !== item.w || block.gridSpan.h !== item.h
      if (moved || resized) {
        onMoveResize(item.i, { x: item.x, y: item.y }, { w: item.w, h: item.h })
      }
    }
  }

  return (
    <GridLayout
      className="layout"
      layout={layout}
      cols={GRID_COLS}
      rowHeight={GRID_ROW_HEIGHT}
      width={width}
      margin={[12, 12]}
      draggableHandle=".wb-drag-handle"
      onDragStop={handleLayoutChange}
      onResizeStop={handleLayoutChange}
    >
      {visible.map((block) => (
        <div key={block.id} className="group/card relative">
          <div
            className="wb-drag-handle absolute top-0 left-0 right-0 z-10 h-7 cursor-grab rounded-t-md bg-muted/40 opacity-0 transition-opacity group-hover/card:opacity-100"
            title="拖动"
          />
          {onRemoveBlock && (
            <button
              type="button"
              onClick={() => onRemoveBlock(block.id)}
              title="移除此看板"
              className={cn(
                "absolute top-0 right-2 z-20 flex size-7 items-center justify-center rounded-lg",
                "text-muted-foreground opacity-0 transition-opacity",
                "hover:bg-destructive/10 hover:text-destructive",
                "group-hover/card:opacity-100"
              )}
            >
              <IconTrash className="size-4" stroke={1.5} />
            </button>
          )}
          <WorkbenchHtmlPanel
            htmlRef={block.htmlRef}
            title={block.title}
            className="h-full overflow-hidden rounded-md"
          />
        </div>
      ))}
    </GridLayout>
  )
}
```

- [ ] **Step 3: 改调用方传 width + onMoveResize**

`react-grid-layout` 需要显式 `width`。在父组件（渲染 `<DraggableWorkbenchGrid>` 处，即 `components/chat/views/workbench-view.tsx`）用容器测宽。找到渲染该组件的位置，包一层 `WidthProvider` 或用 `ResizeObserver`。最简：改用库自带 `WidthProvider`——

在 `draggable-workbench-grid.tsx` 顶部改为：

```tsx
import GridLayout, { WidthProvider, type Layout } from "react-grid-layout"
const ResponsiveGrid = WidthProvider(GridLayout)
```

把组件里 `<GridLayout ... width={width}>` 改为 `<ResponsiveGrid ...>` 并从 props 删除 `width`（WidthProvider 自动注入）。同步把 `DraggableWorkbenchGridProps` 的 `width` 删掉。

然后在 `workbench-view.tsx` 找到 `<DraggableWorkbenchGrid>` 调用，把旧的 `onReorder/onResizeBlock` props 换成新的 `onMoveResize`：

```tsx
<DraggableWorkbenchGrid
  blocks={config.blocks}
  onMoveResize={(id, pos, span) => {
    moveBlock(id, pos)
    resizeBlock(id, span)
  }}
  onRemoveBlock={removeBlock}
/>
```

（`moveBlock`/`resizeBlock`/`removeBlock` 来自 `useWorkbenchConfig`。）

- [ ] **Step 4: typecheck + 构建**

Run: `pnpm --filter web typecheck`
Expected: PASS（全绿）

- [ ] **Step 5: 手动核验**

Run: `pnpm dev`，打开工作台，确认网格能拖拽、缩放吸附、删除；空状态文案更新。

- [ ] **Step 6: 提交**

```bash
git add apps/web/src/components/workbench/draggable-workbench-grid.tsx apps/web/src/components/chat/views/workbench-view.tsx apps/web/package.json pnpm-lock.yaml
git commit -m "feat(workbench): 网格改用 react-grid-layout，飞书风格吸附"
```

---

## Task 6: 服务端 arrange_workbench 工具

**Files:**
- Create: `apps/server/src/service/agent/orchestrator/tools/workbench.py`
- Test: `apps/server/tests/test_workbench_tool.py`

- [ ] **Step 1: 写失败测试**

```python
# apps/server/tests/test_workbench_tool.py
import json
import pytest
from src.service.agent.orchestrator.tools.workbench import (
    normalize_operations,
    SPAN_PRESETS,
)


def test_span_preset_normalization():
    ops = [{"op": "resize", "blockRef": "销售", "span": "large"}]
    out, errors = normalize_operations(ops, valid_paths={"/artifacts/a.html"})
    assert not errors
    assert out[0]["span"] == {"w": 6, "h": 6}


def test_pin_path_not_exist_is_error():
    ops = [{"op": "pin", "resourcePath": "/artifacts/missing.html"}]
    out, errors = normalize_operations(ops, valid_paths={"/artifacts/a.html"})
    assert errors
    assert "missing.html" in errors[0]
    assert out == []  # 校验失败的 pin 不进归一化结果


def test_pin_existing_path_ok():
    ops = [{"op": "pin", "resourcePath": "/artifacts/a.html", "title": "A"}]
    out, errors = normalize_operations(ops, valid_paths={"/artifacts/a.html"})
    assert not errors
    assert out[0] == {"op": "pin", "resourcePath": "/artifacts/a.html", "title": "A"}


def test_unknown_op_is_error():
    ops = [{"op": "explode", "blockRef": "x"}]
    out, errors = normalize_operations(ops, valid_paths=set())
    assert errors
    assert out == []


def test_non_list_input_raises_value_error():
    with pytest.raises(ValueError):
        normalize_operations({"op": "pin"}, valid_paths=set())
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/server && uv run pytest tests/test_workbench_tool.py -v`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现工具**

```python
# apps/server/src/service/agent/orchestrator/tools/workbench.py
"""工作台编排工具：总管在工作台页面内通过对话操控看板。

本工具不直接改工作台配置（配置存在浏览器 localStorage，服务端触达不到），
只负责校验 + 归一化指令，把结果回吐给前端；前端 workbench-arrange handler
事务性地把指令应用到本地工作台配置。
"""

from __future__ import annotations

import json
from pathlib import Path

from langchain_core.tools import tool

from src.core.config import settings
from src.service.agent.orchestrator.runtime import get_conversation_id


SPAN_PRESETS: dict[str, dict[str, int]] = {
    "small": {"w": 3, "h": 2},
    "medium": {"w": 6, "h": 3},
    "large": {"w": 6, "h": 6},
    "full": {"w": 12, "h": 6},
}

_KNOWN_OPS = {"pin", "resize", "move", "rename", "hide", "remove", "reorder"}

# 回吐结果里的 marker，前端 handler 据此识别并解析 operations。
ARRANGE_RESULT_MARKER = "WORKBENCH_ARRANGE_V1"


def _normalize_span(span: object) -> dict[str, int] | None:
    """把 span（档位字符串或 {w,h}）归一化为 {w,h}；非法返回 None。"""
    if isinstance(span, str):
        return SPAN_PRESETS.get(span)
    if isinstance(span, dict) and isinstance(span.get("w"), int) and isinstance(span.get("h"), int):
        return {"w": span["w"], "h": span["h"]}
    return None


def normalize_operations(
    ops: object,
    valid_paths: set[str],
) -> tuple[list[dict], list[str]]:
    """校验并归一化一批 operations。

    返回 (归一化后的合法 operations, 错误信息列表)。
    - pin 的 resourcePath 必须在 valid_paths 内，否则记错误且该 op 丢弃。
    - span 档位字符串归一化为 {w,h}。
    - 未知 op 记错误且丢弃。
    ops 必须是 list，否则抛 ValueError。
    """
    if not isinstance(ops, list):
        raise ValueError("operations 必须是 JSON 数组")

    out: list[dict] = []
    errors: list[str] = []

    for i, op in enumerate(ops):
        if not isinstance(op, dict) or op.get("op") not in _KNOWN_OPS:
            errors.append(f"operations[{i}]：未知或非法指令 {op!r}")
            continue
        kind = op["op"]

        if kind == "pin":
            path = op.get("resourcePath")
            if not isinstance(path, str) or path not in valid_paths:
                errors.append(
                    f"operations[{i}]：产物 {path!r} 在当前会话 /artifacts/ 下不存在，"
                    "请先确认文件名或重新生成"
                )
                continue
            norm = {"op": "pin", "resourcePath": path}
            if isinstance(op.get("title"), str):
                norm["title"] = op["title"]
            if "span" in op:
                span = _normalize_span(op["span"])
                if span is None:
                    errors.append(f"operations[{i}]：span 非法 {op['span']!r}")
                    continue
                norm["span"] = span
            if isinstance(op.get("pos"), dict):
                norm["pos"] = {"x": int(op["pos"].get("x", 0)), "y": int(op["pos"].get("y", 0))}
            out.append(norm)

        elif kind == "resize":
            span = _normalize_span(op.get("span"))
            if span is None or not isinstance(op.get("blockRef"), str):
                errors.append(f"operations[{i}]：resize 缺 blockRef 或 span 非法")
                continue
            out.append({"op": "resize", "blockRef": op["blockRef"], "span": span})

        elif kind == "move":
            pos = op.get("pos")
            if not isinstance(op.get("blockRef"), str) or not isinstance(pos, dict):
                errors.append(f"operations[{i}]：move 缺 blockRef 或 pos")
                continue
            out.append({"op": "move", "blockRef": op["blockRef"],
                        "pos": {"x": int(pos.get("x", 0)), "y": int(pos.get("y", 0))}})

        elif kind == "rename":
            if not isinstance(op.get("blockRef"), str) or not isinstance(op.get("title"), str):
                errors.append(f"operations[{i}]：rename 缺 blockRef 或 title")
                continue
            out.append({"op": "rename", "blockRef": op["blockRef"], "title": op["title"]})

        elif kind in ("hide", "remove"):
            if not isinstance(op.get("blockRef"), str):
                errors.append(f"operations[{i}]：{kind} 缺 blockRef")
                continue
            out.append({"op": kind, "blockRef": op["blockRef"]})

        elif kind == "reorder":
            order = op.get("order")
            if not isinstance(order, list) or not all(isinstance(x, str) for x in order):
                errors.append(f"operations[{i}]：reorder 的 order 必须是字符串数组")
                continue
            out.append({"op": "reorder", "order": order})

    return out, errors


def _current_conversation_html_paths() -> set[str]:
    """列出当前总管会话 /artifacts/ 下的 .html 文件（虚拟路径形式 /artifacts/x.html）。"""
    cid = get_conversation_id()
    if cid is None:
        return set()
    conv_dir = Path(settings.artifacts_path) / str(cid)
    if not conv_dir.is_dir():
        return set()
    paths: set[str] = set()
    for p in conv_dir.rglob("*"):
        if p.is_file() and p.suffix.lower() in (".html", ".htm"):
            rel = p.relative_to(conv_dir).as_posix()
            paths.add(f"/artifacts/{rel}")
    return paths


@tool
def arrange_workbench(operations: str) -> str:
    """编排工作台看板（仅在工作台页面的总管对话里可用）。

    operations 是 JSON 数组字符串，每条 op ∈ {pin, resize, move, rename, hide, remove, reorder}：
      - pin:     {"op":"pin","resourcePath":"/artifacts/x.html","title":"标题","span":"medium","pos":{"x":0,"y":0}}
                 span 可省（默认 medium），可填档位 small/medium/large/full 或 {"w":列,"h":行}；
                 pos 可省（自动找空位）。resourcePath 必须是当前会话 /artifacts/ 下已存在的 .html。
      - resize:  {"op":"resize","blockRef":"销售看板","span":"large"}
      - move:    {"op":"move","blockRef":"销售看板","pos":{"x":0,"y":0}}
      - rename:  {"op":"rename","blockRef":"销售看板","title":"新标题"}
      - hide:    {"op":"hide","blockRef":"销售看板"}
      - remove:  {"op":"remove","blockRef":"销售看板"}
      - reorder: {"op":"reorder","order":["看板A","看板B"]}
    blockRef = 看板当前标题或 1 基序号（你看不到内部 id，用标题/序号即可）。
    用户「放大/缩小」对应升降 span 档位；「放左上」对应 pos {x:0,y:0}；「并排」给相邻 x、相同 y。
    一次可传多条指令，会被一并应用（事务性）。
    """
    try:
        parsed = json.loads(operations)
    except json.JSONDecodeError as exc:
        return f"错误：operations 不是合法 JSON：{exc}"

    try:
        valid_paths = _current_conversation_html_paths()
        normalized, errors = normalize_operations(parsed, valid_paths)
    except ValueError as exc:
        return f"错误：{exc}"

    if not normalized:
        detail = "；".join(errors) if errors else "没有可执行的指令"
        return f"错误：{detail}"

    payload = {"marker": ARRANGE_RESULT_MARKER, "operations": normalized}
    summary = f"已下发 {len(normalized)} 条工作台编排指令。"
    if errors:
        summary += f"（{len(errors)} 条被忽略：{'；'.join(errors)}）"
    # 回吐结构化 payload + 人类可读摘要，前端 handler 解析 marker 段。
    return f"{summary}\n{json.dumps(payload, ensure_ascii=False)}"
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/server && uv run pytest tests/test_workbench_tool.py -v`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/server/src/service/agent/orchestrator/tools/workbench.py apps/server/tests/test_workbench_tool.py
git commit -m "feat(server): arrange_workbench 工具——校验归一化工作台编排指令"
```

---

## Task 7: 注册工具 + system prompt 约定

**Files:**
- Modify: `apps/server/src/service/agent/orchestrator/tools/__init__.py`
- Modify: `apps/server/src/service/agent/orchestrator/agent.py`

- [ ] **Step 1: __init__ re-export**

在 `tools/__init__.py` 加：
- import 段加 `from src.service.agent.orchestrator.tools.workbench import arrange_workbench`
- `__all__` 加 `"arrange_workbench"`

- [ ] **Step 2: agent.py 注册工具**

在 `agent.py` 顶部工具 import 段加 `arrange_workbench`（与 `list_tasks` 等同处导入）。在 `create_deep_agent(... tools=[...])` 列表里加一行（arrange_workbench 不碰 DB、不走网络，**不**包 `_serialize_db_tool`）：

```python
            create_group_and_dispatch,
            arrange_workbench,
```

- [ ] **Step 3: system prompt 注入约定**

找到 `agent.py` 里拼 `system_prompt` 的位置（约 line 232 附近 prefix 拼接处），追加一段工作台编排说明：

```
## 工作台编排
当用户在工作台里要你「做个看板/调整看板」时：
1. 先用现有技能/文件能力生成或更新 .html 产物到当前会话 /artifacts/。
2. 再调 arrange_workbench 把它钉上工作台并排版，一次可下发多条指令（pin/resize/move/rename/hide/remove/reorder）。
3. blockRef 用看板当前标题或序号。当前工作台已有哪些看板，会以「[工作台现状]」上下文给你；据此判断是新钉还是改已有。
不要让用户自己去手动钉或拖拽——这些都由你通过 arrange_workbench 完成。
```

- [ ] **Step 4: 验证工具被加载**

Run: `cd apps/server && uv run python -c "from src.service.agent.orchestrator.tools import arrange_workbench; print(arrange_workbench.name)"`
Expected: 打印 `arrange_workbench`

- [ ] **Step 5: 跑既有工具相关测试确认没破坏**

Run: `cd apps/server && uv run pytest tests/test_employee_tools.py tests/test_workbench_tool.py -v`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add apps/server/src/service/agent/orchestrator/tools/__init__.py apps/server/src/service/agent/orchestrator/agent.py
git commit -m "feat(server): 注册 arrange_workbench + 工作台编排 system 约定"
```

---

## Task 8: 前端 handler + block 类型

**Files:**
- Create: `apps/web/src/lib/chat/tools/handlers/workbench-arrange.ts`
- Test: `apps/web/src/lib/chat/tools/handlers/workbench-arrange.test.ts`
- Modify: `apps/web/src/lib/chat/message-classifier.ts`（ClassifiedBlock 类型定义处）
- Modify: `apps/web/src/lib/chat/tools/block-registry.ts`

- [ ] **Step 1: 写失败测试**

```ts
// apps/web/src/lib/chat/tools/handlers/workbench-arrange.test.ts
import { describe, it, expect } from "vitest"
import { workbenchArrangeHandler } from "./workbench-arrange"
import { parseArrangeResult } from "./workbench-arrange"

describe("workbenchArrangeHandler", () => {
  it("匹配 arrange_workbench 工具", () => {
    expect(workbenchArrangeHandler.match({ toolName: "arrange_workbench" } as any)).toBe(true)
    expect(workbenchArrangeHandler.match({ toolName: "list_tasks" } as any)).toBe(false)
  })

  it("从回吐结果里解析出 operations", () => {
    const resultText =
      '已下发 1 条工作台编排指令。\n{"marker":"WORKBENCH_ARRANGE_V1","operations":[{"op":"pin","resourcePath":"/artifacts/a.html","title":"A"}]}'
    const ops = parseArrangeResult(resultText)
    expect(ops).toEqual([
      { op: "pin", resourcePath: "/artifacts/a.html", title: "A" },
    ])
  })

  it("无 marker 时返回 null", () => {
    expect(parseArrangeResult("普通文本")).toBeNull()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter web test -- src/lib/chat/tools/handlers/workbench-arrange.test.ts`
Expected: FAIL

- [ ] **Step 3: 加 block 类型**

先定位 `ClassifiedBlock` 联合类型定义处（`grep -rn "kind: \"plan-generated\"" apps/web/src/lib/chat` 找到文件，应在 `message-classifier.ts` 或其引用的类型文件）。在该联合类型里加一支（与 `plan-generated` 等并列）：

```ts
  | {
      kind: "workbench-arrange"
      key: string
      toolCallId?: string
      operations: import("@/types/workbench").WorkbenchArrangeOp[]
      summary: string
    }
```

- [ ] **Step 4: 实现 handler**

```ts
// apps/web/src/lib/chat/tools/handlers/workbench-arrange.ts
import type { WorkbenchArrangeOp } from "@/types/workbench"
import type { ToolBlockHandler } from "./plan-generated"

const MARKER = "WORKBENCH_ARRANGE_V1"

/** 从工具回吐文本里解析出 operations 数组；无 marker / 解析失败返回 null。 */
export function parseArrangeResult(
  resultText: string | undefined
): WorkbenchArrangeOp[] | null {
  if (!resultText || !resultText.includes(MARKER)) return null
  // marker JSON 在文本里独占一段，找到第一个 '{' 起的 JSON。
  const start = resultText.indexOf("{")
  if (start < 0) return null
  try {
    const parsed = JSON.parse(resultText.slice(start))
    if (parsed?.marker !== MARKER || !Array.isArray(parsed.operations)) return null
    return parsed.operations as WorkbenchArrangeOp[]
  } catch {
    return null
  }
}

export const workbenchArrangeHandler: ToolBlockHandler = {
  match: (vm) => vm.toolName === "arrange_workbench",
  classify: (vm, messageId, index) => {
    const operations = parseArrangeResult(vm.resultText)
    if (!operations) return null
    const summary = (vm.resultText ?? "").split("\n")[0] ?? "工作台已更新"
    return {
      kind: "workbench-arrange",
      key: `${messageId}:workbench-arrange:${index}`,
      toolCallId: vm.toolCallId,
      operations,
      summary,
    }
  },
}
```

- [ ] **Step 5: 注册 handler**

在 `block-registry.ts`：import `workbenchArrangeHandler`，加入 `TOOL_BLOCK_HANDLERS` 数组。

- [ ] **Step 6: 跑测试确认通过**

Run: `pnpm --filter web test -- src/lib/chat/tools/handlers/workbench-arrange.test.ts`
Expected: PASS

- [ ] **Step 7: 提交**

```bash
git add apps/web/src/lib/chat/tools/handlers/workbench-arrange.ts apps/web/src/lib/chat/tools/handlers/workbench-arrange.test.ts apps/web/src/lib/chat/tools/block-registry.ts apps/web/src/lib/chat/message-classifier.ts
git commit -m "feat(workbench): 前端 workbench-arrange handler 解析编排指令"
```

---

## Task 9: 编排结果卡片——事务应用到工作台

**Files:**
- Create: `apps/web/src/components/chat/message-blocks/workbench-arrange-card.tsx`
- Modify: `apps/web/src/components/chat/message-blocks/block-render-map.tsx`

- [ ] **Step 1: 实现卡片组件**

卡片在挂载时（`useEffect`，按 block.key 去重，只跑一次）把 operations 事务性应用到工作台 config，并显示摘要。

```tsx
// apps/web/src/components/chat/message-blocks/workbench-arrange-card.tsx
import { useEffect, useRef } from "react"
import { IconLayoutGrid } from "@tabler/icons-react"
import { cn } from "@workspace/ui/lib/utils"
import type { WorkbenchArrangeOp } from "@/types/workbench"
import {
  GLOBAL_WORKBENCH_ID,
  applyArrangeOperations,
  emitWorkbenchConfigChanged,
  initializeWorkbenchConfig,
  loadWorkbenchConfig,
} from "@/lib/workbench/workbench-config"

/** 已应用过的 key 集合（模块级，防 React 重渲染/重挂载重复应用）。 */
const appliedKeys = new Set<string>()

export function WorkbenchArrangeCard({
  blockKey,
  operations,
  summary,
  conversationId,
  className,
}: {
  blockKey: string
  operations: WorkbenchArrangeOp[]
  summary: string
  conversationId?: string | number | null
  className?: string
}) {
  const didApply = useRef(false)

  useEffect(() => {
    if (didApply.current || appliedKeys.has(blockKey)) return
    if (conversationId == null) return
    didApply.current = true
    appliedKeys.add(blockKey)
    const cfg =
      loadWorkbenchConfig(GLOBAL_WORKBENCH_ID) ??
      initializeWorkbenchConfig(GLOBAL_WORKBENCH_ID)
    applyArrangeOperations(cfg, operations, conversationId)
    emitWorkbenchConfigChanged()
  }, [blockKey, operations, conversationId])

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs",
        className
      )}
    >
      <IconLayoutGrid className="size-4 text-primary" />
      <span className="text-muted-foreground">{summary}</span>
    </div>
  )
}
```

> 注意：工作台 config 固定用 `GLOBAL_WORKBENCH_ID`（"global"），与资源面板手动钉一致；`conversationId` 来自渲染上下文（总管会话），用于 pin 构造 htmlRef。

- [ ] **Step 2: 接进 render-map**

在 `block-render-map.tsx`：import `WorkbenchArrangeCard`，在 `BlockRenderer` 里 `plan-generated` 分支附近加：

```tsx
  if (block.kind === "workbench-arrange") {
    return (
      <WorkbenchArrangeCard
        key={block.key}
        blockKey={block.key}
        operations={block.operations}
        summary={block.summary}
        conversationId={conversationId}
        className="w-full"
      />
    )
  }
```

- [ ] **Step 3: typecheck**

Run: `pnpm --filter web typecheck`
Expected: PASS

- [ ] **Step 4: 手动核验闭环**

Run: `pnpm dev` + `pnpm dev:server`。在工作台右侧总管对话里说「做一个简单的测试看板并钉到工作台」，确认：总管生成 .html → 调 arrange_workbench → 左侧网格自动出现看板。再说「把它放大」确认 resize 生效。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/components/chat/message-blocks/workbench-arrange-card.tsx apps/web/src/components/chat/message-blocks/block-render-map.tsx
git commit -m "feat(workbench): 编排结果卡片事务应用指令到工作台"
```

---

## Task 10: 工作台现状作为隐藏上下文注入总管

**Files:**
- Modify: `apps/web/src/components/workbench/workbench-content-split.tsx`

> 目标：让总管「看得到」台上有哪些看板（标题/span/pos），否则它无法 resize/move 已有看板。方案：在工作台总管面板，把当前看板清单作为一条隐藏上下文随对话带给总管。具体载体复用总管会话现有的「附加上下文」机制——实现时先查 `CuratorView` / 发消息链路是否已有 system-context / extraContext 注入点，复用它；若没有，则在用户每次发消息前把清单拼进一个不可见的前缀。

- [ ] **Step 1: 查注入点**

Run:
```bash
grep -rn "extraContext\|systemContext\|additionalContext\|hiddenContext\|injectContext" apps/web/src/components/chat/curator apps/web/src/hooks | head
```
确认 CuratorView/发送链路有无现成注入参数。

- [ ] **Step 2: 实现注入**

在 `WorkbenchContentSplit` 里读取工作台 config（监听 `WORKBENCH_CONFIG_CHANGED_EVENT`，用 `loadWorkbenchConfig(GLOBAL_WORKBENCH_ID)`），生成一段紧凑文本：

```tsx
function workbenchContextLine(): string {
  const cfg = loadWorkbenchConfig(GLOBAL_WORKBENCH_ID)
  const blocks = cfg?.blocks ?? []
  if (blocks.length === 0) return "[工作台现状] 当前没有看板。"
  const list = blocks
    .map(
      (b, i) =>
        `${i + 1}. ${b.title}（${b.gridSpan.w}×${b.gridSpan.h}@${b.gridPos.x},${b.gridPos.y}${b.enabled ? "" : "·已隐藏"}）`
    )
    .join("；")
  return `[工作台现状] 现有看板：${list}`
}
```

把这行通过 Step 1 找到的注入点传给 `CuratorView`（作为 extraContext/隐藏前缀）。注入只在 `WorkbenchContentSplit` 内，别处的总管/员工对话不受影响。

> 若 Step 1 没找到现成注入点，则在本 Task 内最小新增：给 `CuratorView` 加一个可选 `extraSystemContext?: string` prop，在其发消息时把它作为隐藏 system 段拼到请求里（参照该会话现有 system_prompt 拼装位置）。这部分按实际代码结构落地，保持「仅工作台场景注入」。

- [ ] **Step 3: typecheck**

Run: `pnpm --filter web typecheck`
Expected: PASS

- [ ] **Step 4: 手动核验**

工作台已有一个看板「销售」时，对总管说「把销售看板放大放左上」，确认它能正确 resize+move 已有看板（说明它读到了现状）。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/components/workbench/workbench-content-split.tsx
git commit -m "feat(workbench): 看板现状作为隐藏上下文注入总管对话"
```

---

## Task 11: 资源面板手动钉适配新网格（兜底入口保留）

**Files:**
- Modify: `apps/web/src/components/artifact/artifact-panel.tsx`

- [ ] **Step 1: 核对 pin 调用**

`artifact-panel.tsx` 的 `pinHtmlToWorkbench` 调 `addHtmlArtifactBlock(config, htmlRef, title)`——Task 3 已让该函数 span/pos 可选并默认 medium + 自动寻空位，所以**手动钉天然兼容新网格，无需改签名**。本 Task 仅核对不报错。

Run: `pnpm --filter web typecheck`
Expected: PASS（artifact-panel 无类型错误）

- [ ] **Step 2: 手动核验**

资源面板右键「钉到工作台」仍可用，钉上来的看板出现在网格里、默认中档、自动落空位。

- [ ] **Step 3: 若有改动则提交**（无改动可跳过）

```bash
git add apps/web/src/components/artifact/artifact-panel.tsx
git commit -m "test(workbench): 核验手动钉兼容规格化网格"
```

---

## Task 12: 全量回归与收尾

- [ ] **Step 1: 前端全量 lint + typecheck + test**

Run:
```bash
pnpm --filter web typecheck
pnpm lint --filter=web
pnpm --filter web test -- src/lib/workbench src/lib/chat/tools/handlers/workbench-arrange.test.ts
```
Expected: 全 PASS

- [ ] **Step 2: 服务端测试**

Run: `cd apps/server && uv run pytest tests/test_workbench_tool.py tests/test_employee_tools.py -v`
Expected: PASS

- [ ] **Step 3: 端到端手动验收（对照 spec 数据流 ①~⑥）**

Run `pnpm dev` + `pnpm dev:server`，在工作台总管对话依次验证：
1. 「做个销售看板放大点放左上」→ 自动生成+钉+大档+左上。
2. 「再做个考勤看板放它右边」→ 第二块落右侧不重叠。
3. 「把销售和考勤并排」→ reorder/move 生效。
4. 「把考勤看板改名叫出勤」→ rename。
5. 「删掉出勤看板」→ remove。
6. 引用不存在产物 → 总管收到错误并自纠，不崩。

- [ ] **Step 4: 最终提交（如有收尾改动）**

```bash
git add -A
git commit -m "chore(workbench): 总管操控工作台 端到端回归收尾"
```

---

## 开放问题落地决策（实现时遵循）

- **span 档位数值**：已定 `小3×2 / 中6×3 / 大6×6 / 满宽12×6`（12 列、行高 120px）。手感不对在 `grid.ts` 调。
- **order vs react-grid-layout 自由摆放**：保留 `order` 字段仅作 reorder 指令的渲染兜底序；实际定位以 `gridPos` 为准。reorder 指令在 `applyArrangeOperations` 里重排 order 后，由网格按各块 gridPos 渲染——若需要「reorder 自动重排坐标」，二期再加自动布局，本期 reorder 只调 order 不动坐标（已在 Task 3 实现为只改 order）。
- **隐藏上下文载体**：Task 10 优先复用现有注入点，无则最小新增 `extraSystemContext` prop。
- **blockRef 用标题的稳定性**：本期用标题/序号；同一轮内若先 rename 再引用，总管应引用新标题（system 约定已说明现状清单）。若实测不稳，二期让回吐结果带 blockId 供后续轮用 id 引用。
