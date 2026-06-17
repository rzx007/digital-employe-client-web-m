# 工作台看板重构：总管生成 HTML → 钉成网格面板

日期：2026-06-16
状态：设计已确认，待写实现计划

## 背景与动机

工作台（`apps/web` 的 `WorkbenchView`）中间区当前的「数据模块」是这样产生的：

1. AI 解析技能 Prompt 里写明的 HTTP 接口（`query-interface-parser`）
2. 用户在「添加数据模块」弹框里选技能、选接口、从**固定 6 种图表类型**（`pie/bar/line/table/metric/list`）里挑一种
3. 由手写的 recharts 渲染器（`data-visualizer.tsx`）出图

这条链路被两件事死死框住：**只能展示技能里能解析出的 HTTP 接口**，且**只能出这 6 种图**。

用户的判断：图表生成本就该交给**总管（curator）助手对话**，由它生成不限于这几种类型的可视化。仓库里已有成熟的产物（artifact）管道——总管对话产出的文件落在会话级 `/artifacts/` 下、按 `{conversationId, path}` 寻址，`.html` 文件已由沙箱 iframe 的 `HtmlArtifactRenderer` 渲染（任意图表库/SVG 都能跑）。因此无需新建渲染或存储管道，只需把"面板的内容来源"从接口解析换成 HTML 产物引用。

## 目标

- 中间区面板 = 总管对话生成的 **HTML 产物**（含任意图表，不限类型）。
- 用户从资源面板把某个 `.html` 产物「钉」成工作台面板。
- 多个看板可在网格里拖拽排序、缩放、删除，配置持久化（沿用现有 localStorage 机制）。
- **完全替换**旧的接口解析 → 固定图表管道（不保留兼容，旧块直接重置）。

## 非目标（YAGNI）

- 不做总管气泡内的「钉到工作台」快捷卡（留二期，本期只做资源面板入口）。
- 不做看板内容的结构化 JSON spec / 统一主题渲染（明确选了 HTML 产物路线）。
- 不改总管对话本身、不改 artifact 渲染管道、不改左栏（日程/今日任务/绩效）。
- 不做旧 `queryInterface` 块到新模型的数据迁移（无法映射，直接丢弃）。

## 看板数据来源：实时（HTML 内 fetch）

**已定**：看板是"活"的——总管生成的 HTML 里**自带 `fetch` 拉接口**，每次打开/刷新面板时在沙箱 iframe 内实时取数据出图。不是生成时的静态快照。

技术现实（已核查现有沙箱）：

- `HtmlArtifactRenderer` 用 `srcDoc` 注入、沙箱为 `allow-scripts allow-same-origin allow-forms allow-popups allow-modals`。**`allow-scripts` 在场，HTML 内的 JS / `fetch` 能执行**——技术上走得通。
- 成败取决于**目标接口的 CORS**。这与现状同源：当前 `data-visualizer.tsx` 本就在渲染进程里直接 `fetch` 这些内网接口，CORS 问题一直存在并已被现有部署接受。新方案不新增 CORS 障碍。
- **唯一新增风险**：`srcDoc` iframe 的请求 `Origin` 可能是 opaque（`null`），与渲染进程直发的 `Origin` 不同；个别后端若按 `Origin` 白名单校验可能表现不同。**这是实现阶段必须先验证的前置项**（见下方"前置验证"），不是阻塞项。

接口地址、请求头、鉴权全部由总管写进 HTML（它本就掌握技能里的接口信息），工作台侧不再解析、不再注入——这正是"把图表/取数交给总管"的核心。

## 前置验证（实现第一步，先做再写组件）

在动任何组件前，先用一个最小 HTML 验证沙箱内 `fetch` 能否打到真实内网接口：

1. 手动在某总管会话产物里放一个 `test-fetch.html`，内含 `fetch('<真实内网接口>').then(...).catch(渲染错误)`。
2. 钉到工作台（或直接在资源面板预览），观察能否取到数据、`Origin` 是否被后端拒。
3. **若通过** → 按本 spec 全量实现。
4. **若被 CORS/Origin 挡** → 方案需补一层代理（Electron 主进程 `net.request` 转发，或后端加 `/proxy` 端点），此时回到设计阶段补充代理子方案，再继续。

此验证结论直接决定后续是否需要新增代理工作量，务必最先做。

## 架构

### 数据模型

`WorkbenchBlock` 的内容来源从接口解析改为 HTML 产物引用。

```ts
// types/workbench.ts

/** 指向某个总管会话产出的 HTML 产物文件 */
interface HtmlArtifactRef {
  /** 产出该 HTML 的总管会话 */
  conversationId: string | number
  /** 会话内资源路径，如 /artifacts/sales-dashboard.html */
  resourcePath: string
  /** 钉住时间戳 */
  pinnedAt: number
}

interface WorkbenchBlock {
  id: string
  /** 重构后唯一类型；旧的 lark-bitable/data-stats/schedule-view/custom 全删 */
  type: "html-artifact"
  title: string
  enabled: boolean
  order: number
  htmlRef: HtmlArtifactRef
  /** 自定义尺寸，沿用现有网格逻辑 */
  width?: number
  height?: number
}

interface WorkbenchConfig {
  employeeId: string        // 仍为 "global"
  blocks: WorkbenchBlock[]
  lastModified: number
}
```

**删除的类型**：`BlockType`、`ChartDisplayType`、`QueryInterface`、`SkillBlockMapping`，以及 `WorkbenchBlock` 上的 `skillId`/`chartType`/`queryInterface`。

### 持久化与旧配置处理

- localStorage 键结构不变（`workbench-config-global`）。
- 加载时检测旧结构：若任一 block 含 `queryInterface` 字段，或 `type` 不是 `"html-artifact"`，判定为旧配置 → **整体重置为空白工作台**（`blocks: []`），并 `console.warn` 提示已重置（不静默丢弃）。
- 初始化不再从技能创建块；新工作台初始为空，引导用户去总管生成并钉住。

### 钉住交互（入口 A，唯一入口）

在资源面板（`artifact-panel.tsx`）中，对 `.html` 文件的右键菜单与预览顶栏新增「📌 钉到工作台」动作：

- 调用 `pinHtmlArtifact({ conversationId, resourcePath, title })`，写入 workbench config。
- 标题默认取文件名（去扩展名），后续可在面板顶栏重命名（本期可选，先用文件名）。
- 钉住后中间区网格立即出现该面板（config 是 localStorage + React state，同窗口内同步）。

### 看板渲染

新增轻包装组件 `workbench-html-panel.tsx`：

- 用现有 `useResourceContentQuery(htmlRef.conversationId, htmlRef.resourcePath)` 取内容（带缓存）。
- 内容传入现有 `HtmlArtifactRenderer`（沙箱 iframe）。
- 顶栏：标题 + 刷新（重载 iframe，重跑内层实时 fetch；总管改了 HTML 时同时失效源码缓存）+ 删除（移出 config，不删源文件）+ 拖拽手柄。
- 源文件取不到 / 404：渲染"产物已不存在，可移除此看板"占位，不崩溃。

### 网格

复用 `DraggableWorkbenchGrid` 的拖拽/排序/缩放/持久化，把每格内容从 `DataVisualizer` 换成 `WorkbenchHtmlPanel`。空状态文案改为引导去总管生成 HTML 看板。

## 数据流

```
总管对话生成 xxx.html  →  落到 /artifacts/（已有）
        │
        ▼
资源面板右键「钉到工作台」  →  pinHtmlArtifact({conversationId, resourcePath, title})
        │
        ▼
workbench-config (localStorage)  ←→  useWorkbenchConfig (React state)
        │
        ▼
DraggableWorkbenchGrid  →  每格 WorkbenchHtmlPanel
        │
        ▼
useResourceContentQuery(conversationId, path)  →  取 HTML 源码
        │
        ▼
HtmlArtifactRenderer (沙箱 iframe)  →  iframe 内 JS 自带 fetch 实时拉接口出图
```

注意两层"取数"要分清：
- **外层**（工作台→渲染器）取的是 **HTML 源码文件**（经 `useResourceContentQuery`，带缓存）。
- **内层**（iframe 内 JS）才是 **实时业务数据 fetch**，由总管写的 HTML 自己负责。
- 面板顶栏「刷新」=重载 iframe（重跑内层 fetch），不只是失效源码缓存。

## 文件去留清单

### 删除（接口解析 → 固定图表整套）

- `components/workbench/add-block-dialog.tsx`
- `components/workbench/data-visualizer.tsx`
- `components/workbench/skill-block-renderer.tsx`
- `lib/workbench/query-interface-parser.ts`
- `lib/workbench/query-interface-resolve.ts`
- `lib/workbench/response-field-analyzer.ts`
- `lib/workbench/parse-response-rows.ts`
- `lib/workbench/ai-extract-headers.ts`
- `lib/workbench/http-headers.ts`
- `lib/workbench/skill-url-extract.ts`
- `lib/workbench/url-template-params.ts`
- `lib/workbench/skill-block-mappings.ts`
- `lib/workbench/skill-interfaces-cache.ts`
- `lib/workbench/chat-send-employee.ts`（核查确认仅被 parser/ai-extract-headers 引用）
- `lib/workbench/local-skill-loader.ts`（核查确认仅被 workbench-view 的技能加载引用）

### 改造（保留壳，换内容）

- `types/workbench.ts` — 删旧枚举/`QueryInterface`，新增 `HtmlArtifactRef`，`WorkbenchBlock` 改字段。
- `lib/workbench/workbench-config.ts` — `addCustomBlock`→`addHtmlArtifactBlock`；删 `createBlocksFromSkills`/技能初始化；初始为空；加旧配置检测重置。
- `hooks/use-workbench-config.ts` — `addBlock(queryInterface)`→`pinHtmlArtifact(htmlRef)`；去掉 `skills` 入参依赖。
- `components/chat/views/workbench-view.tsx` — 删技能加载（`fetchSkillList`/`fetchEmployeeSkillsFromLocal`/`localEnriched`/`chatEmployeeId`）、删 `AddBlockDialog` 与「添加模块」按钮、改空状态文案。
- `components/workbench/draggable-workbench-grid.tsx` — 每格渲染 `WorkbenchHtmlPanel` 替代 `DataVisualizer`/`SkillBlockRenderer`。

### 新增

- `components/workbench/workbench-html-panel.tsx` — 单看板组件。
- 钉住入口 — 在 `artifact-panel.tsx` 对 `.html` 文件加「钉到工作台」action。

### 明确保留不动

- `components/workbench/workbench-content-split.tsx`（三栏 grid/curator/resources 布局）
- `components/workbench/workbench-left-panel.tsx`（日程/今日任务/绩效）
- `components/workbench/workbench-performance-section.tsx` 与 `performance-metrics-card.tsx`（属左栏，**非**图表管道——核查确认）
- `components/workbench/today-task-list.tsx`、`task-status-badge.tsx`、`workbench-shift-calendar-sheet.tsx`、`workbench-curator-sessions-sheet.tsx`
- `resolve-workbench-curator-panel.ts` 及其测试
- `HtmlArtifactRenderer` 及整个 artifact 渲染管道

## 错误处理

- 源文件缺失/404：`WorkbenchHtmlPanel` 显示占位 + 移除按钮，不崩溃。
- 旧 localStorage 配置：检测到即重置为空 + `console.warn`，不静默。
- 取内容失败（网络）：面板内显示重试。

## 测试

- 保留：`resolve-workbench-curator-panel.test.ts`（不受影响）。
- 新增：`workbench-config` 旧配置检测重置 / `addHtmlArtifactBlock` / 排序删除的单测。
- 新增：`workbench-html-panel` 源文件缺失时渲染占位的测试。

## 开放问题

- 面板标题重命名是否本期做？暂定否（先用文件名），留接口。
- 总管改了同名 HTML 后，钉住的面板是否自动刷新？本期靠手动刷新按钮；自动刷新（监听资源变更）留观察。
- **沙箱内 fetch 能否打到内网接口**——见"前置验证"，结论决定是否需补代理层。这是本方案最大不确定项。
- 是否需要给总管一份"生成工作台看板 HTML"的提示约定（比如固定容器尺寸自适应、错误兜底、用哪个图表库）？暂不做硬约定，先看总管自由发挥的产物质量，必要时再补 system prompt / skill 引导。
