# browserctl 同源 iframe 支持 — 设计

- 日期：2026-06-25
- 状态：设计已与用户确认，待 spec review
- 分支：`feat/browserctl-commands`（续在四命令之上，避免 ax-tree/debugger-controller 文件冲突）

## 背景与问题

数字员工内嵌浏览器的 `browserctl snapshot` 通过 CDP `Accessibility.getFullAXTree`（**不带 frame 参数**）取页面可访问性树，再由 `buildRefs` 解析成 `@eN` 引用列表供 `click`/`fill` 等动作定位。

`getFullAXTree` 不带 `frameId` 时**只返回主 frame 的 a11y 树**：iframe 元素本身是一个叶子节点，其内部文档（子控件）不在树里。因此 iframe 内的输入框、按钮、下拉等**抓不到 `@eN`**，无法操作。许多企业系统（OA/ERP/报表）用 iframe 承载子页面，这是高频卡点。

## 关键发现：动作层天然跨 frame

`@eN` 只携带 `backendDOMNodeId`。该 ID 在 CDP 中**全局唯一、跨 frame 通用**：

- `DOM.getBoxModel { backendNodeId }` 返回的 content quad 是**顶层视口坐标**（同源 / in-process frame）；`click`/`scroll` 用这坐标 `Input.dispatchMouseEvent` 即可。
- `DOM.resolveNode { backendNodeId }` → `Runtime.callFunctionOn` 绑定到该节点所属 frame 的正确执行上下文；`fill`/`select`/`get value-attr`/`scrollIntoView` 均走此路。

因此 **`click`/`fill`/`select`/`get`/`scroll` 五个动作零改动**就能操作 iframe 内控件——只要 snapshot 能把 iframe 内元素暴露成 `@eN`。改动集中在 snapshot + buildRefs 两处。

## 目标 / 非目标

**目标**

- `snapshot` 遍历整页 frame 树，把每个**单 session 能取到 a11y 树的 frame**（同源 / in-process，覆盖企业系统绝大多数 iframe）的元素拼成一份连续编号的 `@eN` 列表。
- 嵌套 iframe 自动覆盖（frame 树递归）。
- 取不到树的 frame（跨源 OOPIF）**优雅降级**：跳过 + 日志，不报错，主页面照常。
- 动作层（click/fill/select/get/scroll）不改。

**非目标（本期不做）**

- **操作跨源 OOPIF 内部**。需 `Target.attachToTarget` 自动附着子 target + flatten session 逐 frame 发命令（Playwright/Puppeteer 那套），是显著更大的工程。等出现"某个必须操作的 iframe 恰好跨源"的具体需求再做阶段二。
- **selector 在 iframe 内生效**。`resolveNode`/`scrollIntoView` 的 selector 兜底跑 `document.querySelector`（主 frame 上下文），iframe 内 selector 抓不到。`@eN` 已覆盖，文档引导优先 `@eN`，仅补一句说明。

## 设计

### snapshot 改造（`browser-debugger-controller.ts`）

```
snapshot(maxNodes = 200):
  Accessibility.enable
  // 主 frame：保留现有轮询，等 RootWebArea 暴露子节点或超时 3s
  mainNodes = 轮询 getFullAXTree（不带 frameId）直到 rootChildCount>0 或超时

  tree = Page.getFrameTree()
  mainFrameId = tree.frame.id
  childFrameIds = collectChildFrames(tree)   // 递归收集除主 frame 外的所有子 frame id

  framesNodes = [mainNodes]                   // 主 frame 已取，作为第一组，不在循环里重复取
  for fid in childFrameIds:
    try:
      nodes = Accessibility.getFullAXTree({ frameId: fid })
      framesNodes.push(nodes)
    catch:
      // 跨源 OOPIF / frame 已卸载：单 frame 失败不拖垮整体
      logger.info("[browser-debugger] snapshot frame skipped", { frameId: fid })

  refs = buildRefs(framesNodes, maxNodes)
  this.refCache = refs
  return { ok: true, data: { refs } }
```

要点：

- **frame 收集用 `Page.getFrameTree`**：返回主 frame + 子 frame 树，递归取每个 `frame.id`。`Page.getFrameTree` 是查询型命令，通常无需 `Page.enable`（实现时验证）。
- **逐 frame `getFullAXTree({ frameId })` 包独立 try/catch**：这是"同源拼进来、跨源降级"的实现核心——无需预判 frame 是否同源，按实际能取到与否分流。
- **主 frame 取一次、不重复取**：`Page.getFrameTree` 返回的 `tree.frame.id` 即主 frame，`collectChildFrames` **只收子 frame**（排除主 frame）。主 frame 的 a11y 树由现有轮询逻辑取得（SPA a11y 树惰性构建，需等 RootWebArea 出子节点），直接作为 `framesNodes` 第一组，**不**在循环里用 `getFullAXTree({frameId: mainFrameId})` 再取一次。这样既避免重复 `@eN`，也不依赖"带主 frameId 取树是否等价于不带参数轮询"这一未验证行为。
- **maxNodes 是全局上限**：所有 frame 的 refs 连续编号到 `maxNodes` 截断。截断时日志记录，避免"看起来抓全了其实没有"。

### buildRefs 改造（`ax-tree.ts`）

现状：`buildRefs(nodes, maxNodes)` 用**单个** `nodeMap<string, AxNode>`，找第一个 `RootWebArea` 开始 walk。

问题：多 frame 时，AXNodeId（`nodeId`/`childIds`）**在每个 frame 内独立编号、跨 frame 会重名**。若塞进同一个 nodeMap，后一个 frame 的节点会覆盖前一个的同号节点，遍历错乱。

改造：

- 签名改为接受**每个 frame 一组节点**：`buildRefs(framesNodes: AxNode[][], maxNodes)`。
- **每组建独立 `nodeMap`**，各自从该组的 `RootWebArea` 开始 walk；`@eN` 计数器（`counter`）、`refs` 数组、`maxNodes` 上限在所有 frame 间**全局共享、连续累加**。
- 输出顺序：主 frame 的 refs 在前，各子 frame 依次追加（透明合并，Agent 靠 role/name 定位，顺序非关键）。
- **每个 frame 的 `RootWebArea` 照常输出一个 ref**（与主 frame 现有行为一致，不特意跳过子根——统一逻辑、实现最简；子 frame 的 WebArea ref 数量少，噪音可忽略，且隐含分隔了 frame 边界）。
- 单 frame 调用通过传 `[nodes]` 即可，保持纯函数、好测。

`@eN` 仍只携带 `backendDOMNodeId`（全局唯一），所以下游 `resolveNode`/`getBbox`/`runOnElement` **完全不用改**。

## 数据流

```
browserctl snapshot
  → http-bridge: case "snapshot"（不变）
    → controller.snapshot()
        Page.getFrameTree → [mainFrameId, child1, child2, ...]
        逐 frame Accessibility.getFullAXTree({frameId})（try/catch）
        → framesNodes: AxNode[][]
        → buildRefs(framesNodes, maxNodes)
            每组独立 nodeMap，共享 counter → refs: RefNode[]（连续 @eN，含 iframe 内元素）
    → 返回 refs
后续 click/fill/select/get/scroll @eN：
  resolveNode → getBbox(DOM.getBoxModel) / DOM.resolveNode → callFunctionOn
  （backendNodeId 全局唯一，跨 frame 天然可用，零改动）
```

## 边界与错误处理

- **跨源 OOPIF frame**：`getFullAXTree({frameId})` 抛错 → catch 跳过 + 日志。snapshot 不含其内容，但不报错、主页面元素照常返回。
- **frame 加载未完成**：iframe 内容异步。主 frame 保留现有轮询；**子 frame 尽力而为**（snapshot 当下能取多少取多少），不为子 frame 单独加轮询（避免拖慢、YAGNI）。若 iframe 未就绪，Agent 照常 `wait` 后重新 `snapshot`。
- **frame 在遍历间被卸载**：`getFullAXTree` 抛错 → catch 跳过。
- **maxNodes 截断**：连续编号到上限即停，日志记录被截断的事实。
- **selector 路径**：iframe 内 selector 仍抓不到（主 frame 上下文），保持现状；文档说明。

## 测试策略

- **buildRefs 多 frame 单测**（`ax-tree.test.ts`，node:test + tsx）：
  - 喂两组 nodes（模拟主 frame + 一个 iframe），两组 AXNodeId **故意重名**，验证：连续编号不串、独立 nodeMap 不互相覆盖、两个 frame 的可交互节点都出现在 refs 里。
  - 单 frame（传 `[nodes]`）行为与改造前一致（回归）。
  - 某组为空 / 无 RootWebArea 时不崩。
- **E2E（手动 GUI，与四命令合并前一起跑）**：
  - 造一个本地页：主页嵌**同源** iframe，iframe 内含 `<input>`/`<button>`/`<select>`。
  - `snapshot` → 看到 iframe 内控件的 `@eN`；`fill @eN` → `get value @eN` 校验落地；`click @eN`（iframe 内按钮）生效；`select @eN` 选中。
  - 在一个真实带 iframe 的系统上验证：跨源 frame 被跳过、snapshot 不崩、主页面照常。

## 受影响文件

| 文件 | 改动 |
|---|---|
| `apps/web/electron/features/browser/ax-tree.ts` | `buildRefs` 改为多 frame 输入（每组独立 nodeMap、共享 counter） |
| `apps/web/electron/features/browser/ax-tree.test.ts` | 新增多 frame 单测 + 单 frame 回归 |
| `apps/web/electron/features/browser/browser-debugger-controller.ts` | `snapshot` 遍历 frame 树、逐 frame try/catch 取树、调多 frame 版 buildRefs |
| `apps/server/build-in-skills/browser-runtime/reference.md` | 补 iframe 支持范围 + selector 限制说明 |
| `apps/server/build-in-skills/browser-runtime/SKILL.md` | 补一句 iframe 同源支持 |

动作层（http-bridge / index.js / click·fill·select·get·scroll 实现）**不改**。

## 风险

- **`getFullAXTree` 的 `frameId` 参数行为**是唯一需 spike 验证的点：确认它接受 `frameId`、对同源 in-process frame 返回该 frame 子树、对跨源 OOPIF 抛错（被 catch）。若行为与预期不符，回退方案是从主 frame a11y 树定位 iframe 节点 + 同源 `Runtime.evaluate` 读 `contentDocument`——但优先验证标准 CDP 路径。
- **坐标对 OOPIF**：本期不操作 OOPIF（已跳过其 frame），故无此风险；仅同源 in-process frame 参与动作，坐标为顶层视口坐标。
