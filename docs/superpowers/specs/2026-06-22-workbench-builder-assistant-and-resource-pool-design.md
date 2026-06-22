# 工作台助手 + 资源池 + 协作台升级 — 设计

日期：2026-06-22
状态：设计已确认，待写实现计划

## 背景与动机

### 现状

[2026-06-19-curator-controls-workbench-design](2026-06-19-curator-controls-workbench-design.md) 让总管在工作台页面内通过对话直接操控看板（钉/改尺寸/移位等），工具 `arrange_workbench` 只挂在总管 ([orchestrator/tools/__init__.py:71](../../../apps/server/src/service/agent/orchestrator/tools/__init__.py#L71))。这把"做看板"和"管员工/派单/编排"两件事都堆给了总管：

- 总管 prompts 要同时讲调度规则和工作台编排规则（[prompts.py:121 build_workbench_arrange_section](../../../apps/server/src/service/agent/prompts.py#L121)）。
- 一旦想给"做看板"加更多能力（配色规范、ECharts 用法、响应式布局…），都得塞进总管系统提示。
- 总管的角色心智被稀释——"老板"和"看板设计师"两件事在同一个 agent 里相互拉扯。

### 用户的诉求（原话）

> 加一个普通的业务员工，身上有工作台的技能，跟普通的业务员工一样，只是现在有一个资源池，工作台右上角，用户可以把资源池的 html 拖到工作台，工作台这里开一个工作台助手现场做这个的对话，或者总管助手派发任务给工作台助手

进一步：

> 我切换到工作台之后，我就一直干工作台的任务，我直接给工作台员工下发任务

→ 工作台是用户**专门做看板**的场所，"派单给总管"不是必须中介；用户直接在工作台跟做看板的员工对话。

### 本设计要做什么

把"做看板"从总管职责里**剥离出去**，让它成为**一项可装可卸的技能**：

- 新增内置员工 **工作台助手**（普通业务员工，0 特殊待遇），默认装内置技能 `workbench-builder`。
- `arrange_workbench` 工具按**技能即权限**挂载：装了 `workbench-builder` 技能的员工才有这个工具。
- **总管不再有 `arrange_workbench` 工具**——总管纯粹做老板（派单/管员工/管技能），不直接操控工作台。
- 工作台右侧对话面板从"固定总管"升级为**"工作台成员"切换器**（N 选一，总管不在）。"工作台成员" = 用户主动邀请进工作台的、装了 `workbench-builder` 技能的员工。
- 新增**资源池**：工作台右上角面板，承载用户精选的 HTML 看板。用户主动入池/上传/拖入网格。

### 两种典型用户路径（已确认）

| 场景 | 用户动作 |
|---|---|
| 想随手做看板 | 进工作台 → 切换器选工作台助手（默认成员）→ 直接对话 → 助手 `arrange_workbench` 钉上 |
| 想"老板帮我安排" | 在主聊天找总管 → 总管派单给工作台助手 → 工作台右上角弹通知"助手开始做了" → 用户点击切到工作台看进度（SSE 在工作台页面活）→ 助手做完 `arrange_workbench` 钉上 |
| 已有 HTML 想直接用 | 工作台右上角资源池"上传" → 拖到网格 |
| 历史看板复用 | 资源池里挑一个拖到网格 |

两条路都通向"工作台助手在自己会话里 `arrange_workbench`"——**唯一前提是用户在工作台页面切到了那个对话**（让 SSE 流在工作台页面活）。

## 范围

- **本期做**：工作台助手种子员工 + `workbench-builder` 内置技能 + `arrange_workbench` 工具按技能挂载（总管收掉）+ 工作台右侧对话切换器（N 选一，总管不在）+ 工作台成员邀请 + 资源池（DB + UI + 上传 + 拖入网格 + 主动入池）。
- **本期不做**：远端"看板市场"（跨用户分享/发布看板）；技能 `workbench-builder` 在对话中被改写/版本管理；"对话挂目录"或 opencode 风格的工作空间重构；解除 `conv_seg` 切片。

## 非目标（YAGNI）

- 远端看板市场 / 跨用户分享 / 看板审核流。
- 工作台助手不进切换器的特殊形态（如浮窗、独立顶栏入口）——他就是个普通员工，复用员工对话面板即可。
- 总管"代用户入池"或"代用户钉"——所有入池/拖入网格动作严格由用户触发。
- 工作台助手在对话里自动入池——同上。
- 自动扫文件系统把所有 `.html` 当资源——只收用户主动入池 + 上传的。
- 工作台 config 搬服务端——保持 localStorage，配合"切到他让 SSE 在工作台页面活"的链路。
- 对 [2026-06-19-curator-controls-workbench-design](2026-06-19-curator-controls-workbench-design.md) 既有 `arrange_workbench` 服务端 marker / 回吐协议 / 前端 handler 的破坏性修改——本设计是**搬挂载点 + 扩使用对象**，工具本身的协议不动。

## 核心架构

### 心智模型对照

| | 主聊天页 | 工作台页 |
|---|---|---|
| 切换器 | 总管 + 所有员工（含工作台助手） | 仅"工作台成员"（不含总管） |
| 用户在这里做什么 | 跟总管派活、问员工、做日常 | 直接跟"做看板的人"对话；看/改看板 |
| `arrange_workbench` 工具可用方 | 装了 `workbench-builder` 技能的员工（如工作台助手） | 同左（但 SSE 流在本页面活，效果当场可见） |

→ 工作台 = "制作车间"心智。主聊天 = "总指挥部"心智。两个页面**互不替代**，用户按场景切。

### 工具挂载从"工具集硬编码"换成"技能即权限"

现状：`arrange_workbench` 在 [orchestrator/tools/__init__.py:71](../../../apps/server/src/service/agent/orchestrator/tools/__init__.py#L71) re-export，被 [orchestrator/agent.py](../../../apps/server/src/service/agent/orchestrator/agent.py) 装到总管工具集。

改后：
1. 工具实现搬到通用位置（如 `apps/server/src/service/agent/tools/workbench.py`），脱离 `orchestrator/` 命名空间。
2. [employee.py get_agent](../../../apps/server/src/service/agent/employee.py#L62) 加一个"装了 `workbench-builder` 技能 → 挂 `arrange_workbench`"的条件分支。
3. 总管 agent 不再装 `arrange_workbench`。删除：
   - [orchestrator/tools/__init__.py:71](../../../apps/server/src/service/agent/orchestrator/tools/__init__.py#L71) 的 re-export 行；
   - [orchestrator/agent.py:40](../../../apps/server/src/service/agent/orchestrator/agent.py#L40) 的 import；
   - [prompts.py:121 build_workbench_arrange_section](../../../apps/server/src/service/agent/prompts.py#L121) 整段；总管 system prompt 不再包含这一段。
4. 总管碰到"做看板"请求时**派单给工作台助手**——`create_orchestration_plan` 直接走，不写新工具。

工具本身的协议（[workbench.py](../../../apps/server/src/service/agent/orchestrator/tools/workbench.py) 的 `ARRANGE_RESULT_MARKER` 回吐 + 前端 `workbench-arrange` handler 应用）**完全不动**——只是它现在被谁调用变了。

### 工作台助手 = 种子员工 + 默认装技能

[employee_service.py:36 `_BUILTIN_SEED_EMPLOYEES`](../../../apps/server/src/service/employee_service.py#L36) 加一条：

```python
("工作台助手", ("workbench-builder",), "在工作台里做、改、组织 HTML 看板。"),
```

- 跟"浏览器助手"等其他种子员工**完全同一档**：可改可删、出现在员工列表、能被总管派单、能进群。
- 0 保留名 / 0 特殊路由 / 0 新 agent runtime——复用 [employee.py get_agent](../../../apps/server/src/service/agent/employee.py#L62)。
- 通过装 `workbench-builder` 技能，自动获得 `arrange_workbench` 工具（见上节）。

### 内置技能 `workbench-builder`

放进 `BUILD_IN_SKILLS_DIR/workbench-builder/SKILL.md`，跟 [orchestrator_skills/doc-coauthoring](../../../apps/server/orchestrator_skills/doc-coauthoring/SKILL.md) 等现有技能同一档。

SKILL.md 内容大纲（详细文案实现期定）：

- **何时触发**：用户在工作台对话里说"做 / 改 / 组织看板"。
- **工作流**：
  1. 用 `write_file` 把 HTML 产物写到当前 artifacts 目录（按现有员工 artifacts 路径规则）。
  2. 调 `arrange_workbench` 钉上工作台（支持批量：pin/resize/move/rename/hide/remove/reorder）。
  3. 协议遵循 [现有 arrange_workbench 服务端契约](../../../apps/server/src/service/agent/orchestrator/tools/workbench.py)（`pin.resourcePath` 只填文件名，`blockRef` 用标题或序号）。
- **不要**：①不要在对话里贴完整 HTML；②不要"自作主张"把产物入资源池——资源池入口仅用户触发；③别用 `arrange_workbench` 之外的方式操控看板。

### 工作台对话切换器

工作台页面右侧对话面板（[workbench-content-split.tsx](../../../apps/web/src/components/workbench/workbench-content-split.tsx)）从固定 `CuratorView` 改成切换器：

- **成员列表**：装了 `workbench-builder` 技能的、被用户邀请进工作台的员工。**总管不在**。
- **默认成员**：工作台助手（种子员工首次创建时自动进成员列表）。
- **邀请入口**："+ 邀请员工到工作台"按钮，弹出"装了 `workbench-builder` 技能的员工"列表（前端按 `skills_json` 过滤），用户勾选。
- **切换器形态**：员工头像横排 + 选中态高亮；移出按钮（鼠标悬停显示）。
- **会话粒度**：每个员工的对话**和员工聊天页一致**（[2026-06-13 多会话清单](2026-06-13-employee-skill-creation-uplift-design.md) 已确认的员工多会话模型）——切换器选员工后展示他的会话列表 + 当前对话；新建会话走员工聊天的现有路径。

### 工作台成员持久化：复用 workbench-config localStorage

在 [workbench-config.ts:15 GLOBAL_WORKBENCH_ID](../../../apps/web/src/lib/workbench/workbench-config.ts#L15) 既有 localStorage 桶 `workbench-config-global` 里扩展字段：

```ts
interface WorkbenchConfig {
  employeeId: string
  blocks: WorkbenchBlock[]
  lastModified: number
  members: number[]  // 新增：邀请进工作台的员工 id 列表
}
```

- 不动后端、不开新表。
- 跟工作台 layout / blocks 同生命周期：清 config = 清成员，自然。
- 单机/单浏览器范围——和工作台 layout 的现有持久化范围一致。
- 首次启动：默认包含工作台助手 id（应用启动后由前端读到种子员工 id 后补齐）。

### 资源池：DB 表 + UI 面板 + 上传通道

#### 数据模型

新增表 `workbench_resources`：

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | int PK | |
| `workspace_id` | int FK | 跟随工作空间 |
| `source` | enum(`employee_artifact`, `upload`) | 来源 |
| `src_path` | str | HTML 文件路径（相对 workspace.root_path） |
| `title` | str | 用户给的标题（入池时填，默认取文件名） |
| `added_by` | str / int | 用户标识；agent 不允许写表（仅用户路径） |
| `created_at` | datetime | |

来源拆分理由：①`employee_artifact` 指向已有员工产物文件，**入池不复制**，仅登记引用；②`upload` 用户从本机上传的，复制到 `workspace.root_path/workbench-uploads/<uuid>/<原文件名>` 后登记。

#### API

新文件 `apps/server/src/api/workbench_resource_api.py`：

- `GET /workbench-resources/list?workspace_id=` — 列表
- `POST /workbench-resources/add` — 从已有 artifacts 入池（body: `{ workspace_id, src_path, title? }`）
- `POST /workbench-resources/upload` — 文件上传（multipart, body: `{ workspace_id, file, title? }`）
- `DELETE /workbench-resources/{id}` — 从池子移除（`upload` 来源同时删物理文件；`employee_artifact` 来源仅删登记）

权限：所有写操作必须由**前端用户动作**触发——agent 工具集不包含任何资源池写工具。即使将来加，也是用户授权的显式动作。

#### UI

工作台右上角面板（[workbench-content-split.tsx](../../../apps/web/src/components/workbench/workbench-content-split.tsx) 的 `resources` 已存在但默认折叠 `resources: 0`）：

- 展开后显示资源列表（缩略图占位 / 标题 / 来源标签）。
- 顶部按钮：「上传 HTML」「关闭面板」。
- 每个资源卡片支持**拖拽**：拖到中间网格区 → 等同于"钉到工作台"，复用 [addHtmlArtifactBlock](../../../apps/web/src/lib/workbench/workbench-config.ts) 现有路径，不调 `arrange_workbench`。
- 每个资源卡片右键 / hover 操作：删除（带确认）、重命名（仅改 title 字段）。

#### 资源 → 工作台网格的拖拽

复用现有的"钉到工作台"路径：

- 资源池里的 `employee_artifact` 资源拖入网格 → 直接 `addHtmlArtifactBlock({ htmlRef: { conversationId, resourcePath, pinnedAt } })`，跟资源面板"📌 钉到工作台"右键同链路。
- `upload` 资源拖入网格 → 需要新构造 `HtmlArtifactRef`。`conversationId` 为 0 或 `"upload"` 字符串占位，`resourcePath` 指向 `workbench-uploads/<uuid>/<file>`；渲染时 [WorkbenchHtmlPanel](../../../apps/web/src/components/workbench/workbench-html-panel.tsx) 走"按绝对路径取 HTML"分支。

需轻微扩展 [HtmlArtifactRef](../../../apps/web/src/types/workbench.ts) 的 `conversationId` 类型说明（已是 `string | number`，开包容"upload" 字面量），渲染路径需在拿到 ref 时按 source 分流。

### 总管派单 → 工作台通知

用户在主聊天里让总管派单做看板：

1. 总管现有 `create_orchestration_plan` 链路不动，派单给工作台助手。
2. 工作台助手在执行会话里干活、调 `arrange_workbench`。
3. **如果用户当时不在工作台页面** → SSE 流不在工作台 → `arrange_workbench` 回吐的指令前端 handler 收不到（与现有 `arrange_workbench` 设计一致）。
4. 为此：**工作台页面右上角监听总管派单事件**，弹一条 toast：「工作台助手开始做 <task summary>，去看？」点击 → 切换器自动切到工作台助手 → 该助手的执行会话激活 → SSE 在工作台页面活 → 后续 `arrange_workbench` 指令当场生效。

实现要点：

- 总管派单事件可通过现有的工作台 SSE / 群通知通道送达前端（实现期定哪条通道最轻）。
- 通知出现的页面：仅工作台页面。主聊天里总管的回执卡片照旧。
- 不弹自动切——用户点 toast 才切，不抢视野。
- 历史 already-completed 的派单（用户错过 toast 时）：用户后续自己进工作台 + 切到助手会话，arrange 指令本应在 SSE 流早期到达，但因 SSE 是 push 流不可补，**这是已知限制**：用户错过 toast 时，钉不上是预期行为。要复盘只能去主聊天看助手会话历史里 `arrange_workbench` 调用过、产物已生成，手动拖入资源池或网格补救。

## 错误处理

- **arrange_workbench 跨会话**：本设计 = 用户主动切换到对的对话让 SSE 复活。用户没切：产物落 artifacts 但工作台不动，**不报错**，符合"按需生效"语义。
- **资源池源文件被删**：`employee_artifact` 资源的 `src_path` 不存在时，前端卡片显示"产物已不存在"占位，提供"从池子移除"按钮。
- **upload 文件上传失败 / 超大**：API 层校验大小上限（参考现有上传约定，如 `MAX_DOWNLOAD_ZIP_BYTES` 50MB），返回 4xx，前端 toast 错误。
- **邀请的员工技能被删**：用户在员工管理里删了 `workbench-builder` 技能 → 该员工失去 `arrange_workbench`。工作台切换器本期**不主动校验**——他还在成员列表里，但聊天里调不了 `arrange_workbench`。用户感知到再手动移除即可。后续可加"启动校验+自动移除"，本期不做（YAGNI）。
- **总管 prompt 删 `build_workbench_arrange_section` 后的回退**：若发现总管被用户问到工作台问题不知所措 → 在总管 prompt 加一句**指向**："工作台编排请派单给工作台助手"，但工具仍不挂。

## 测试

### 后端单元

- `tests/test_builtin_seed_employees.py` 加断言：种子员工集合包含 `("工作台助手", frozenset({"workbench-builder"}))`。
- 新 `tests/test_workbench_resource_service.py`：list/add/upload/delete 的 CRUD；权限校验（缺 workspace_id / 越权）；upload 的文件路径生成与清理。
- `tests/test_arrange_workbench_mounted_by_skill.py`：构造装了 `workbench-builder` 技能的员工，调 `get_agent`，断言工具集包含 `arrange_workbench`；不装则不包含；总管 agent 工具集不再包含 `arrange_workbench`。

### 前端单元

- 切换器组件：邀请 / 移出 / 切换激活成员的状态行为。
- workbench-config 的 `members` 字段读写、首次启动默认填工作台助手 id 的 effect。
- 资源池拖拽 → 网格 `addHtmlArtifactBlock` 链路（已有部分逻辑可复用）。
- upload 来源的 HtmlArtifactRef 构造与 `WorkbenchHtmlPanel` 取 HTML 的分流。

### 集成 / 手动

- 用户在工作台跟工作台助手对话「做销售看板」→ 看板出现在网格。
- 在主聊天给总管派单「做销售看板」→ 工作台右上角弹 toast → 点击 → 切到助手 → 看到 SSE 流 → 钉上。
- 资源池上传一个本地 HTML → 拖到网格 → 渲染。
- 邀请第二个员工（手动装 `workbench-builder` 技能）→ 工作台切换器多一项 → 用他做看板 → 钉上。
- 把工作台助手从成员里移出 → 切换器不再显示他。

## 文件清单

### 新增

- `apps/server/src/service/agent/tools/workbench.py`（或类似通用位置）— `arrange_workbench` 工具迁移目标，协议不动。
- `apps/server/src/models/workbench_resource.py` — DB model。
- `apps/server/src/schemas/workbench_resource.py` — Pydantic schema。
- `apps/server/src/service/workbench_resource_service.py` — CRUD 业务逻辑。
- `apps/server/src/api/workbench_resource_api.py` — REST API。
- `apps/server/tests/test_workbench_resource_service.py`
- `apps/server/tests/test_arrange_workbench_mounted_by_skill.py`
- `BUILD_IN_SKILLS_DIR/workbench-builder/SKILL.md` — 内置技能。
- DB migration：新表 `workbench_resources` + workspace 下新建目录 `workbench-uploads/` 的约定（首次上传时 lazy 创建）。
- 前端新增：
  - `apps/web/src/components/workbench/workbench-chat-switcher.tsx` — 切换器。
  - `apps/web/src/components/workbench/workbench-resource-panel.tsx` — 资源池面板。
  - `apps/web/src/components/workbench/workbench-invite-member-dialog.tsx` — 邀请员工弹窗。
  - `apps/web/src/api/workbench-resources.ts` — API client。
  - `apps/web/src/hooks/use-workbench-resources.ts` — TanStack Query hook。

### 改造

- [apps/server/src/service/employee_service.py:36 `_BUILTIN_SEED_EMPLOYEES`](../../../apps/server/src/service/employee_service.py#L36) — 加 `("工作台助手", ("workbench-builder",), "...")`。
- [apps/server/src/service/agent/employee.py get_agent](../../../apps/server/src/service/agent/employee.py#L62) — 装了 `workbench-builder` 技能时挂 `arrange_workbench`。
- [apps/server/src/service/agent/orchestrator/tools/__init__.py:71](../../../apps/server/src/service/agent/orchestrator/tools/__init__.py#L71) — 删 `arrange_workbench` re-export。
- [apps/server/src/service/agent/orchestrator/agent.py:40](../../../apps/server/src/service/agent/orchestrator/agent.py#L40) — 删 `arrange_workbench` import。
- [apps/server/src/service/agent/prompts.py:121 build_workbench_arrange_section](../../../apps/server/src/service/agent/prompts.py#L121) — 整段删除；总管 prompt 装配处对应不再调用。
- [apps/web/src/components/workbench/workbench-content-split.tsx](../../../apps/web/src/components/workbench/workbench-content-split.tsx) — 右侧 `curator` panel 改成切换器；`resources: 0` 默认改成可展开（按用户偏好 / 上次状态）；右上角加派单 toast 监听点。
- [apps/web/src/lib/workbench/workbench-config.ts](../../../apps/web/src/lib/workbench/workbench-config.ts) + [types/workbench.ts](../../../apps/web/src/types/workbench.ts) — `WorkbenchConfig` 加 `members: number[]`；`isValidConfig` 校验；缺省读为 `[]`。
- [apps/web/src/components/workbench/workbench-html-panel.tsx](../../../apps/web/src/components/workbench/workbench-html-panel.tsx) — 渲染分流：`upload` 来源 ref → 按绝对路径取 HTML。

### 保留不动

- `arrange_workbench` 工具的服务端契约（`ARRANGE_RESULT_MARKER` / pin/resize/move/... 7 个 op / span 档位归一化）。
- 前端 `workbench-arrange` handler。
- 工作台网格（`react-grid-layout` 集成 / [draggable-workbench-grid.tsx](../../../apps/web/src/components/workbench/draggable-workbench-grid.tsx)）。
- `HtmlArtifactRenderer` 沙箱 iframe / `WorkbenchHtmlPanel` 大部分逻辑。
- 员工聊天的会话/流式机制（切换器复用之）。
- 工作台左栏（日程/今日任务/绩效）。

## 依赖

- 无新 npm / pip 依赖。
- `react-grid-layout` 已在 [2026-06-19-curator-controls-workbench-design](2026-06-19-curator-controls-workbench-design.md) 引入。

## 开放问题

- 总管派单事件如何送达工作台页面（toast 触发）—— 实现期选最轻通道（现有 SSE 复用 vs 现有 group/notification 总线）；不影响整体架构。
- 切换器组件的具体形态：员工头像横排 vs 下拉——实现期看视觉对齐；不影响功能。
- 资源池缩略图：本期不渲染缩略图（占位图标），实现期看是否补 HTML 静态截图能力（[WorkbenchHtmlPanel](../../../apps/web/src/components/workbench/workbench-html-panel.tsx) 已有 iframe，可考虑 canvas 截图）；不阻塞主流程。
- 工作台助手种子员工**首次创建时间点** vs **前端读到他 id 写入 `members`** 之间的竞态——实现期需要一个 effect "成员列表为空时去 list 员工找工作台助手 id 补"；不引入新接口。

## 关联

- 起点设计：[2026-06-19-curator-controls-workbench-design](2026-06-19-curator-controls-workbench-design.md) —— 引入了 `arrange_workbench` 工具与工作台 config 的契约。本设计在此基础上**搬挂载点、扩使用对象**。
- 上游种子员工机制：[employee_service.py:1220 `ensure_builtin_seed_employees`](../../../apps/server/src/service/employee_service.py#L1220)。
- 上游员工对话/会话模型：[2026-06-13-employee-skill-creation-uplift-design](2026-06-13-employee-skill-creation-uplift-design.md) —— 切换器复用员工聊天的多会话清单。
