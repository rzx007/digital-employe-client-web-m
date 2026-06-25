# 工作台结构化 Widget + 多标签页改造 — 设计文档

- 日期：2026-06-24
- 状态：已评审待实现
- 背景调研：A2UI（Google 声明式 generative-UI 协议）思路契合但不直接采用，详见「调研结论」。

## 1. 背景与问题

当前工作台（`apps/web/src/components/chat/views/workbench-view.tsx`）：

- 左栏：写死的 KPI/日历/任务卡（API 驱动，本设计不动）。
- 中间网格：**总管（后端 orchestrator）生成 HTML artifact，前端塞进 sandbox iframe 渲染**，配合 fetch/XHR proxy 拦截处理 CORS；dnd-kit 拖拽/缩放；配置存 localStorage。
- 右侧：总管对话面板 + 资源池面板。

问题：统计块是写死的整页 HTML，不灵活、难做"千人千面"；让 LLM 写对一整页带样式 HTML 困难；iframe 跑 AI 生成代码有安全/脆弱性（proxy hack）。

诉求：工作台展示用户关注指标，数据来自「与 agent 交互产生的业务数据」或「用户提供的数据源（接口）」，由总管生成合适的统计块；理论上千人千面。

## 2. 调研结论（A2UI）

A2UI = Google 开源的声明式 generative-UI **协议**（v0.9.1 稳定 / v1.0 RC）：UI 即数据（扁平邻接表，LLM 友好、可流式），客户端用预注册的**可信组件目录**渲染，agent 不执行代码。框架无关；React 目前只能经 CopilotKit 的 `@copilotkit/a2ui-renderer`（绑 AG-UI 整套运行时）。内置目录偏表单（Button/TextField/Card/DateTimeInput），**无图表/数据可视化组件**；设计场景是会话内临时 UI，非持久化看板。

判断：**思路对（声明式 UI + 可信组件目录，正好解决"写死 HTML 不灵活 + iframe 风险"），但不直接采用**——太新、React 接入重、无图表目录（而图表是工作台核心）、形态是会话临时 UI 而非持久化看板。

决策：**借鉴其范式，自建面向仪表盘的轻量声明式 widget schema**，用自有可信组件目录（shadcn/ui + recharts）渲染。将来 A2UI v1.0 出官方 React 渲染器+图表目录可平滑映射。

## 3. 总体架构与数据流

工作台主区（中间「网格区」）改为**浏览器式多标签页**结构；右侧总管面板、资源池面板保留（三栏 split 不变）。

```
┌─ [工作台] [销售看板.html] [周报.html] ─────────┐   ← 标签栏(浏览器式)
│   当前标签内容,占满中间内容区(全屏于内容区)      │
└──────────────────────────────────────────────┘
```

- **第 1 个标签「工作台」**：固定首位、不可关闭、不可被拖到非首位。内容是**结构化 widget 看板**（复用现有 dnd-kit 网格，多个 KPI/图表/表格 widget 拼接）。
- **其余标签**：资源管理器里 HTML artifact 右键「钉到工作台」→ 新开一个标签，**全屏展示该 HTML**（占满中间内容区，不盖住总管/资源池面板）。可关闭、可重排（dashboard 标签除外）。
- HTML 标签**复用现有 iframe sandbox 渲染**（`WorkbenchHtmlPanel`），iframe/proxy 这套保留，仅服务于 HTML 标签。

数据流：

```
总管 → 工具 add_workbench_widget(spec)
     → 后端 pydantic 按 widget 目录校验 → 追加进 user 的 dashboard.widgets → workbench_config 表
前端 react-query GET /workbench → widgets[] / htmlTabs[]
     → 标签区渲染:dashboard 标签走 WidgetRenderer;HTML 标签走 iframe
       · widget.data 内联快照 → 直接渲染
       · widget.dataSource(metricId) → useQuery 调 resolve 接口,按 refreshSec 刷新("活看板")
用户拖拽/缩放/删除/关标签 → 防抖 PUT /workbench 回写后端
```

## 4. 数据模型与 Widget Schema

**工作台配置只按 user 分区**（去掉 workspace 维度；一个用户一份工作台，跨工作空间共用）。

```ts
WorkbenchConfig {
  dashboard: { widgets: WorkbenchWidget[] }   // 固定首个标签内容
  htmlTabs: HtmlTab[]                          // 其余全屏 HTML 标签(无序;顺序由 tabOrder 决定)
  tabOrder: string[]                           // 标签顺序的唯一来源,含 "dashboard" + htmlTab id
  activeTabId?: string                         // 持久化当前选中标签;缺省/失效 → "dashboard"
  updatedAt: number
}
```

排序与生命周期约定：

- `tabOrder` 是标签顺序的**唯一来源**（`HtmlTab` 不再带 `order`）；`"dashboard"` 恒为 `tabOrder[0]`，前端禁止拖到非首位。
- 钉新 HTML → 追加 id 到 `tabOrder` 末尾 + 设 `activeTabId`；关标签 → 从 `htmlTabs` 和 `tabOrder` 同时移除该 id；若关的是当前标签则 `activeTabId` 回退到相邻标签或 `"dashboard"`。
- 读取时 `tabOrder` 里指向不存在 htmlTab 的 id 一律忽略（自愈）。

```ts

HtmlTab {
  id: string
  title: string
  htmlRef: { conversationId: string|number; resourcePath: string; pinnedAt: number }
}

WorkbenchWidget {
  id: string
  type: "kpi" | "line" | "bar" | "area" | "table" | "progress" | "list"
  title: string
  subtitle?: string
  order: number
  width?: number; height?: number             // 复用现有网格布局字段
  data?: WidgetData                           // ① 内联快照
  dataSource?: { metricId: string; params?: object; refreshSec?: number }  // ② 名字化实时
  options?: WidgetOptions                      // 各类型显示配置
}
```

各 type 的 `WidgetData` 形状（也是 resolve 接口返回形状，二者同构）：

| type | data 形状 |
|---|---|
| `kpi` | `{ items: [{ label, value, unit?, delta?, deltaDir?: "up"\|"down"\|"flat" }] }` |
| `line`/`area`/`bar` | `{ rows: object[], xKey: string, series: [{ key, label, color? }] }` |
| `table` | `{ columns: [{ key, label, align?, format? }], rows: object[] }` |
| `progress` | `{ items: [{ label, value, max?, color? }] }` |
| `list` | `{ items: [{ title, value?, badge?, icon? }] }` |

绑定规则：`dataSource` 存在 → `useQuery(["metric", metricId, params])` 取数，`refreshSec` → `refetchInterval`；`data` 存在 → 直接渲染；两者都给 → 以 `dataSource` 为准、`data` 作首屏占位。

## 5. Widget 目录与渲染注册表（shadcn/ui）

`type → 可信 React 组件`，置于 `apps/web/src/components/workbench/widgets/`。**全部遵循 shadcn/ui 规范**（用 `@workspace/ui` 组件，图表走 shadcn Chart 封装而非裸 recharts）。

| type | 组件 | shadcn 基座 |
|---|---|---|
| `kpi` | `KpiWidget` | `Card` + `Badge`（涨跌）+ `@tabler` 箭头图标 |
| `line`/`area`/`bar` | `ChartWidget` | shadcn **Chart**（`ChartContainer`/`ChartConfig`/`ChartTooltip`/`ChartLegend`）over recharts |
| `table` | `TableWidget` | shadcn `Table` |
| `progress` | `ProgressWidget` | shadcn `Progress` + `Card` |
| `list` | `ListWidget` | `Card` + 列表 + `Badge` |

- `WidgetRenderer` 按 `type` 查注册表；**未知 type → 兜底卡片**（"不支持的组件类型 x"，不崩）。
- 无 `dangerouslySetInnerHTML`、无裸 recharts；文本经 React 转义。
- 缺的 shadcn 组件用 `pnpm dlx shadcn@latest add chart table progress -c apps/web` 补齐。

## 6. 后端（Python FastAPI orchestrator）

- **表 `workbench_config`**：`user_id`（主键）、`config`（JSON = WorkbenchConfig）、`updated_at`。`user_id` 由请求 token 在后端解析得到（不再由前端传 `"global"`；前端 `GET/PUT /workbench` 不带 id）。
- **API**：
  - `GET /workbench` → 当前用户配置（无则返回默认空 dashboard）。
  - `PUT /workbench` → 整体回写（前端拖拽/缩放/删除/关标签后防抖保存）。
  - `POST /workbench/metrics/{metricId}:resolve` → body 带 `params`，返回对应 type 的 `WidgetData`；未注册 metricId → 404。
- **agent 工具 `add_workbench_widget(spec)`**：pydantic 按 widget 目录校验（type 合法、data/dataSource 至少其一、dataSource.metricId 在白名单），追加进当前用户 `dashboard.widgets`，返回 widget id。`remove_workbench_widget(id)` 可选，本期可不做。
- **指标注册表（本期接现有几个）**：`metricId → resolver(params) -> WidgetData`。**白名单是单一来源**——`add_workbench_widget` 的 pydantic 校验和 resolve 接口的 404 判定都读同一个注册表常量,不得各自维护。首批：
  - `monthly_performance` ← 现有 `/performance/monthly-balance`，塑成 `kpi`。
  - `task_calendar` ← `/tasks/calendar/monthly`，塑成 `table`/`list`。
  - `today_tasks` ← today 任务，塑成 `list`/`kpi`。

## 7. 前端改造

- **`WorkbenchContentSplit` 中间「网格区」→「标签区」`WorkbenchTabs`**：标签栏（浏览器式）+ 内容区；右侧总管/资源池面板与三栏 split 不动。
- **标签**：
  - `dashboard` 标签固定首位、不可关闭/不可移位 → 内容是 `DraggableWorkbenchGrid`（复用现有 dnd-kit 网格）渲染 `dashboard.widgets`，每块走 `WidgetRenderer`。
  - HTML 标签：复用 `WorkbenchHtmlPanel`（iframe sandbox），改为占满内容区全屏；可关闭、可重排。
- **数据层**：`useWorkbenchConfig` 由 localStorage 改为 react-query 读 `GET /workbench`，变更走防抖 `PUT`。保留 `WORKBENCH_CONFIG_CHANGED_EVENT`/`WORKBENCH_OPEN_RESOURCES_EVENT`；新增「钉 HTML → 加 htmlTab + 切到该标签」。
- **widget 取数**：`dataSource` widget 用 `useQuery` 调 resolve，`refreshSec` → `refetchInterval`；`data` 内联直接渲。

## 8. 迁移、安全、测试

- **迁移**：**不迁移**。现有 localStorage 旧 `html-artifact` block 直接弃用（不读旧 key），从空 dashboard 起步。
- **安全**：dashboard widget 全声明式、可信组件渲染、无 HTML 注入；`dataSource` 仅白名单 metricId。HTML 标签仍是用户主动 pin 的 agent 生成 HTML，沿用 iframe sandbox 隔离——风险面与现状一致，未扩大。
- **测试**：
  - 后端：pydantic schema 校验、各 resolver 塑形、`add_workbench_widget` 工具、resolve 接口（含未注册 404）。
  - 前端：每类 widget 渲染、未知 type 兜底、resolve hook、标签增删/dashboard 不可关不可移、`dataSource` 刷新。

## 9. 复用 vs 新建（影响清单）

- **保留不动**：左栏 KPI/日历/任务；右侧总管/资源池面板；三栏 `react-resizable-panels` split；dnd-kit 网格拖拽/缩放；HTML iframe sandbox 渲染（移到 HTML 标签）；资源管理器右键 pin 流程（落点改为 htmlTab）。
- **新建**：widget schema/类型；5 个 widget 组件 + `WidgetRenderer` + 注册表；`WorkbenchTabs` 标签区；后端 `workbench_config` 表 + 3 个 API + `add_workbench_widget` 工具 + 指标注册表。
- **改造**：`useWorkbenchConfig`（localStorage → 后端 react-query）；中间区由「网格」换为「标签区」。
- **废弃**：localStorage 工作台配置；网格里的 `html-artifact` 小卡片形态。
