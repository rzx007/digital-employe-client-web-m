# browserctl 同源 iframe 支持 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `browserctl snapshot` 遍历整页 frame 树，把同源/in-process iframe 内的元素也暴露成 `@eN`，使 click/fill/select/get/scroll 能操作 iframe 内控件；跨源 OOPIF 优雅降级。

**Architecture:** 改两层纯逻辑 + 一处接线。`buildRefs` 从单 frame 输入改为多 frame 输入（每组独立 nodeMap，避免 AXNodeId 跨 frame 重名串味，`@eN` 全局连续编号）；新增 `collectChildFrames` 纯函数递归收集子 frame id；`snapshot` 用 `Page.getFrameTree` + 逐 frame `getFullAXTree({frameId})`（try/catch 降级）把各 frame 节点喂给 `buildRefs`。动作层完全不改——`@eN` 只携带全局唯一的 `backendDOMNodeId`，天然跨 frame。

**Tech Stack:** Electron `webContents.debugger`(CDP), TypeScript, node:test + tsx 单测。

**Spec:** [docs/superpowers/specs/2026-06-25-browserctl-iframe-support-design.md](../specs/2026-06-25-browserctl-iframe-support-design.md)

**分支:** `feat/browserctl-commands`（续在四命令之上）。

**约定:** 子代理只 `git add` 自己明确列出的文件路径，**禁止** `git add .` / `-A` / `git commit -a`（工作树可能有他人未提交改动）。

**测试运行（在 `apps/web` 目录下）:**
- 单文件：`node --import tsx --test electron/features/browser/<file>.test.ts`
- 全 browser 模块：`node --import tsx --test electron/features/browser/*.test.ts`

---

### Task 1: buildRefs 改为多 frame 输入

把 `buildRefs(nodes, maxNodes)` 重构为 `buildRefs(framesNodes, maxNodes)`：接受「每个 frame 一组节点」的二维数组，每组建独立 `nodeMap`、各自找 `RootWebArea` 走，`@eN` 计数器与 `maxNodes` 上限全局共享、连续累加。本任务同步把唯一调用点临时改成 `buildRefs([nodes], …)` 保持可编译，Task 3 再改成真正多 frame。

**Files:**
- Modify: `apps/web/electron/features/browser/ax-tree.ts`
- Modify: `apps/web/electron/features/browser/ax-tree.test.ts`
- Modify: `apps/web/electron/features/browser/browser-debugger-controller.ts:138`（调用点跟签名）

- [ ] **Step 1: 写失败测试（多 frame 不串味 + 全局编号 + 截断 + 空组）**

在 `ax-tree.test.ts` 末尾追加：

```typescript
test("多 frame：各组独立 nodeMap，AXNodeId 跨组重名不串，@eN 全局连续编号", () => {
  const mainNodes = [
    { nodeId: "1", role: { value: "RootWebArea" }, childIds: ["2"], backendDOMNodeId: 1 },
    { nodeId: "2", role: { value: "button" }, name: { value: "主页按钮" }, backendDOMNodeId: 10 },
  ]
  const iframeNodes = [
    // 故意复用 nodeId "1"/"2"，模拟另一 frame 的独立编号
    { nodeId: "1", role: { value: "RootWebArea" }, childIds: ["2"], backendDOMNodeId: 2 },
    { nodeId: "2", role: { value: "textbox" }, name: { value: "iframe输入" }, backendDOMNodeId: 20 },
  ]
  const refs = buildRefs([mainNodes, iframeNodes], 200)
  const names = refs.map((r) => r.name)
  assert.ok(names.includes("主页按钮"), "主 frame 节点应在")
  assert.ok(names.includes("iframe输入"), "iframe 节点应在")
  // 连续编号 @e0.. 且无重复
  assert.deepEqual(
    refs.map((r) => r.ref),
    refs.map((_, i) => `@e${i}`)
  )
  // backendNodeId 没被另一组同号节点覆盖
  assert.equal(refs.find((r) => r.name === "iframe输入")?.backendNodeId, 20)
})

test("多 frame：maxNodes 跨 frame 全局截断", () => {
  const f1 = [
    { nodeId: "1", role: { value: "RootWebArea" }, childIds: ["2"] },
    { nodeId: "2", role: { value: "button" } },
  ]
  const f2 = [
    { nodeId: "1", role: { value: "RootWebArea" }, childIds: ["2"] },
    { nodeId: "2", role: { value: "button" } },
  ]
  assert.equal(buildRefs([f1, f2], 3).length, 3)
})

test("多 frame：空组 / 无 RootWebArea 组不崩", () => {
  const f1 = [
    { nodeId: "1", role: { value: "RootWebArea" }, childIds: ["2"] },
    { nodeId: "2", role: { value: "button" }, name: { value: "ok" } },
  ]
  const refs = buildRefs([[], f1], 200)
  assert.ok(refs.some((r) => r.name === "ok"))
})
```

同时把**现有 5 个用例**里的 `buildRefs(nodes, 200)` / `buildRefs(nodes, 2)` 改为包一层数组：`buildRefs([nodes], 200)` / `buildRefs([nodes], 2)`（机械替换，共 5 处）。

- [ ] **Step 2: 跑测试，确认新用例失败**

Run: `cd apps/web && node --import tsx --test electron/features/browser/ax-tree.test.ts`
Expected: **全部用例（含已包成 `[nodes]` 的 5 个旧用例 + 3 个新用例）FAIL**——旧 `buildRefs` 签名是 `(nodes, maxNodes)`，收到二维数组后 `node.nodeId` 全 undefined → nodeMap 空 → refs 形态全不符。Step 3 实现后才会转绿（Step 5 的「8 个 PASS」是真正门禁）。

- [ ] **Step 3: 重构 buildRefs**

把 `ax-tree.ts` 的 `buildRefs` 整体替换为（walk 逻辑不变，只是按 frame 分组、nodeMap 每组独立、counter/refs/maxNodes 外层共享）：

```typescript
export function buildRefs(framesNodes: unknown[][], maxNodes: number): RefNode[] {
  const refs: RefNode[] = []
  let counter = 0

  const walkFrame = (nodes: unknown[]) => {
    const nodeMap = new Map<string, AxNode>()
    for (const n of nodes) {
      const node = n as AxNode
      if (node.nodeId != null) nodeMap.set(String(node.nodeId), node)
    }

    const walk = (node: AxNode, depth: number) => {
      if (refs.length >= maxNodes) return
      const role = node.role?.value ?? "generic"
      if (node.ignored) {
        if (node.childIds) {
          for (const childId of node.childIds) {
            const child = nodeMap.get(String(childId))
            if (child) walk(child, depth)
          }
        }
        return
      }
      if (MASKED_ROLES.has(role)) {
        refs.push({
          ref: `@e${counter++}`,
          role,
          name: "[masked]",
          value: null,
          backendNodeId: node.backendDOMNodeId ?? 0,
          depth,
        })
        return
      }
      if (
        ["presentation", "none"].includes(role) &&
        !node.name?.value &&
        depth > 2
      ) {
        return
      }

      refs.push({
        ref: `@e${counter++}`,
        role,
        name: node.name?.value ?? null,
        value: node.value?.value ?? null,
        backendNodeId: node.backendDOMNodeId ?? 0,
        depth,
      })

      if (node.childIds) {
        for (const childId of node.childIds) {
          const child = nodeMap.get(String(childId))
          if (child) walk(child, depth + 1)
        }
      }
    }

    const root = nodes.find(
      (n) => (n as AxNode).role?.value === "RootWebArea"
    ) as AxNode | undefined
    if (root) walk(root, 0)
    else for (const n of nodes) walk(n as AxNode, 0)
  }

  for (const nodes of framesNodes) {
    if (refs.length >= maxNodes) break
    walkFrame(nodes)
  }

  return refs
}
```

（`MASKED_ROLES`、`RefNode`、`AxNode` 定义保持不动。）

- [ ] **Step 4: 改唯一调用点保持可编译**

`browser-debugger-controller.ts:138` 当前 `const refs = buildRefs(nodes, maxNodes)` → 改为 `const refs = buildRefs([nodes], maxNodes)`（Task 3 会替换成真正多 frame，这里先保证签名匹配）。

- [ ] **Step 5: 跑测试，确认全绿**

Run: `cd apps/web && node --import tsx --test electron/features/browser/ax-tree.test.ts`
Expected: 全部 PASS（8 个用例：5 旧 + 3 新）。

- [ ] **Step 6: Commit**

```bash
git add apps/web/electron/features/browser/ax-tree.ts apps/web/electron/features/browser/ax-tree.test.ts apps/web/electron/features/browser/browser-debugger-controller.ts
git commit -m "refactor(browser): buildRefs 改多 frame 输入(每组独立 nodeMap+全局连续编号)"
```

---

### Task 2: collectChildFrames 纯函数

新增 `frame-tree.ts`：从 CDP `Page.getFrameTree` 结果递归收集**除主 frame 外**的所有子 frame id。

**Files:**
- Create: `apps/web/electron/features/browser/frame-tree.ts`
- Create: `apps/web/electron/features/browser/frame-tree.test.ts`

- [ ] **Step 1: 写失败测试**

`frame-tree.test.ts`:

```typescript
import test from "node:test"
import assert from "node:assert/strict"

import { collectChildFrames } from "./frame-tree"

test("递归收集所有子 frame id（含嵌套），不含主 frame", () => {
  const tree = {
    frame: { id: "main" },
    childFrames: [
      { frame: { id: "c1" }, childFrames: [{ frame: { id: "c1a" } }] },
      { frame: { id: "c2" } },
    ],
  }
  assert.deepEqual(collectChildFrames(tree), ["c1", "c1a", "c2"])
})

test("无子 frame 返回空数组", () => {
  assert.deepEqual(collectChildFrames({ frame: { id: "main" } }), [])
})
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `cd apps/web && node --import tsx --test electron/features/browser/frame-tree.test.ts`
Expected: FAIL（`collectChildFrames` 未定义 / 模块不存在）。

- [ ] **Step 3: 实现**

`frame-tree.ts`:

```typescript
// 解析 CDP Page.getFrameTree 返回的 frame 树。纯函数，无 Electron 依赖，便于单测。

export interface FrameTreeNode {
  frame: { id: string }
  childFrames?: FrameTreeNode[]
}

// 递归收集除根（主 frame）外的所有子 frame id（深度优先）。
export function collectChildFrames(tree: FrameTreeNode): string[] {
  const ids: string[] = []
  const visit = (node: FrameTreeNode) => {
    for (const child of node.childFrames ?? []) {
      ids.push(child.frame.id)
      visit(child)
    }
  }
  visit(tree)
  return ids
}
```

- [ ] **Step 4: 跑测试，确认通过**

Run: `cd apps/web && node --import tsx --test electron/features/browser/frame-tree.test.ts`
Expected: PASS（2 用例）。

- [ ] **Step 5: Commit**

```bash
git add apps/web/electron/features/browser/frame-tree.ts apps/web/electron/features/browser/frame-tree.test.ts
git commit -m "feat(browser): collectChildFrames 纯函数(递归收集子 frame id)"
```

---

### Task 3: snapshot 遍历 frame 树（接线）

`snapshot` 主 frame 保留现有轮询，再用 `Page.getFrameTree` + 逐子 frame `getFullAXTree({frameId})`（每 frame try/catch 降级），把各 frame 节点喂多 frame 版 `buildRefs`。无单测（纯 CDP 集成），靠类型检查 + Task 5 手动 E2E。

**Files:**
- Modify: `apps/web/electron/features/browser/browser-debugger-controller.ts`（import 区 + `snapshot` 方法 117-150）

- [ ] **Step 1: 加 import**

在 `browser-debugger-controller.ts` 顶部 import 区（紧跟 `import type { AxNode, RefNode } from "./ax-tree"` 之后）加：

```typescript
import { collectChildFrames } from "./frame-tree"
import type { FrameTreeNode } from "./frame-tree"
```

- [ ] **Step 2: 替换 snapshot 方法**

把 `snapshot`（约 117-150）整体替换为：

```typescript
  async snapshot(maxNodes = 200): Promise<CdpResult<{ refs: RefNode[] }>> {
    try {
      await this.sendCommand("Accessibility.enable")
      // 主 frame：a11y 树惰性构建，轮询直到 RootWebArea 暴露子节点或超时 3s
      let mainNodes: unknown[] = []
      let rootChildCount = 0
      const deadline = Date.now() + 3000
      for (;;) {
        const result = (await this.sendCommand(
          "Accessibility.getFullAXTree"
        )) as { nodes?: unknown[] }
        mainNodes = result.nodes ?? []
        const root = mainNodes.find(
          (n) => (n as AxNode).role?.value === "RootWebArea"
        ) as AxNode | undefined
        rootChildCount = root?.childIds?.length ?? 0
        if (rootChildCount > 0 || Date.now() >= deadline) break
        await new Promise((r) => setTimeout(r, 150))
      }

      // 子 frame：同源/in-process 能取到树→拼入；跨源 OOPIF 取不到→跳过、不崩
      const framesNodes: unknown[][] = [mainNodes]
      let skippedFrames = 0
      try {
        const tree = (await this.sendCommand("Page.getFrameTree")) as {
          frameTree?: FrameTreeNode
        }
        const childFrameIds = tree.frameTree
          ? collectChildFrames(tree.frameTree)
          : []
        for (const frameId of childFrameIds) {
          try {
            const r = (await this.sendCommand("Accessibility.getFullAXTree", {
              frameId,
            })) as { nodes?: unknown[] }
            framesNodes.push(r.nodes ?? [])
          } catch (err) {
            // 跨源 OOPIF 单 session 取不到树属预期；记 debug 以便与真实 CDP 异常区分
            skippedFrames++
            logger.debug("[browser-debugger] snapshot frame skipped", {
              frameId,
              err: (err as Error).message,
            })
          }
        }
      } catch (e) {
        // getFrameTree 失败：退化为仅主 frame，不影响主流程（用 warn：意外、非预期）
        logger.warn("[browser-debugger] getFrameTree failed, main-frame only", {
          err: (e as Error).message,
        })
      }

      const refs = buildRefs(framesNodes, maxNodes)
      this.refCache = refs
      logger.info("[browser-debugger] snapshot", {
        frames: framesNodes.length,
        skippedFrames,
        mainRawNodes: mainNodes.length,
        rootChildCount,
        refs: refs.length,
        truncated: refs.length >= maxNodes,
      })
      return { ok: true, data: { refs } }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  }
```

> **Spike 提示（实现者注意，Task 5 E2E 验证）:** `Page.getFrameTree` 一般无需 `Page.enable` 即可查询；若 E2E 时返回空/报错，在 `Accessibility.enable` 后补一行 `await this.sendCommand("Page.enable")`。`getFullAXTree({frameId})` 对同源 in-process frame 应返回该 frame 子树、对跨源 OOPIF 抛错（被内层 catch 跳过）——E2E 验证此行为。

- [ ] **Step 3: 确认现有 ax-tree 测试仍绿（调用点已在 Task 1 改对，本任务不碰单测）**

Run: `cd apps/web && node --import tsx --test electron/features/browser/*.test.ts`
Expected: ax-tree + frame-tree 全 PASS（snapshot 本身无单测，确保没破坏既有测试）。

- [ ] **Step 4: Commit**

```bash
git add apps/web/electron/features/browser/browser-debugger-controller.ts
git commit -m "feat(browser): snapshot 遍历 frame 树(逐 frame getFullAXTree+跨源优雅降级)"
```

---

### Task 4: 文档更新

在 SKILL.md / reference.md 补 iframe 同源支持范围 + selector 限制。

**Files:**
- Modify: `apps/server/build-in-skills/browser-runtime/reference.md`
- Modify: `apps/server/build-in-skills/browser-runtime/SKILL.md`

- [ ] **Step 1: reference.md**

在 `snapshot` 命令行（约第 70 行 `browserctl snapshot ...`）下方补一条说明（紧随该行）：

```markdown
> `snapshot` 会自动遍历同源 iframe：iframe 内的元素也会出现在 `@eN` 列表里，可直接 `click`/`fill`/`select`/`get`/`scroll`。跨源 iframe（不同域，走独立进程）会被静默跳过、不影响主页面。**iframe 内只能用 `@eN` 定位，CSS 选择器不跨 frame**（选择器只在主文档生效），优先用 `@eN`。
```

- [ ] **Step 2: SKILL.md**

在「常用命令」代码块里 `browserctl snapshot --max-nodes 200` 那行后补注释，或在其后加一句引文。在第 60 行附近 `browserctl snapshot --max-nodes 200` 行尾加注释：

```bash
browserctl snapshot --max-nodes 200   # 自动含同源 iframe 内元素；跨源 iframe 跳过
```

并在「标准工作流」第 2 步末尾补一句：

> iframe（同源）内的控件会一并出现在 snapshot 的 `@eN` 里，照常 click/fill 即可；iframe 内只能用 `@eN`，不要用 CSS 选择器。

- [ ] **Step 3: Commit**

```bash
git add apps/server/build-in-skills/browser-runtime/reference.md apps/server/build-in-skills/browser-runtime/SKILL.md
git commit -m "docs(browser-runtime): 说明 snapshot 同源 iframe 支持 + iframe 内仅 @eN"
```

---

### Task 5: 手动 GUI E2E（人工，与四命令一起验收）

> 需重启 `pnpm --filter web dev:app`（snapshot 改在 Electron 主进程，必须重启）。本任务不由子代理自动执行，留人工。

- [ ] **Step 1: 同源 iframe 基本可见可操作**
  - 打开一个含**同源** iframe 且 iframe 内有表单的页面（自家系统，或本地起 dev 服务放 parent.html 内嵌 child.html）。
  - `browserctl snapshot --interactive` → 确认 iframe 内的 `<input>`/`<button>`/`<select>` 出现在 `@eN` 列表。
  - `browserctl fill @eN "测试"` → `browserctl get value @eN` 返回 "测试"。
  - `browserctl click @eN`（iframe 内按钮）→ 触发预期行为。
  - `browserctl select @eN --label "..."`（iframe 内原生 select）→ 选中。

- [ ] **Step 2: 嵌套 iframe**
  - 若有 iframe 套 iframe 的页面，确认最内层控件也在 `@eN` 里。

- [ ] **Step 3: 跨源优雅降级**
  - 打开一个含**跨源** iframe（如嵌第三方/广告）的页面。
  - `browserctl snapshot` 不报错、主页面元素照常返回；看 `[browser-debugger] snapshot` 主日志行（info 级，必可见）的 `skippedFrames > 0` 字段确认有 frame 被跳过（逐 frame 的 skip 明细是 debug 级，需开 debug 才见）。

- [ ] **Step 4: 主 frame 无 iframe 回归**
  - 普通无 iframe 页面 `snapshot` 行为与改造前一致（无重复 `@eN`、`frames: 1`）。

---

## 收尾

Task 1–4 由子代理完成并各自 review 通过、单测全绿后：
1. `cd apps/web && node --import tsx --test electron/features/browser/*.test.ts` 整体回归。
2. 用户做 Task 5 手动 E2E。
3. E2E 通过后，连同四命令一起走 superpowers:finishing-a-development-branch 合并回 dev。
