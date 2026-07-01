# 多工作空间 + 团队/对话用户级（SP1）— 设计 spec

- 日期：2026-06-17
- 分支：feat/orchestrator-centric
- 这是「工作空间模型重构」的第 1 个子项目（SP1）。SP2（产物统一进项目目录）、SP3（沙箱/越狱权限，即 B）另开。

## 1. 背景与问题

**现状（探查确认）**：工作空间 ≈ 用户（1:1）。`Workspace.user_id` 是所有者；用户登录就认领 workspace #1 或新建一个自己的空间。所有资源（员工/技能/任务/会话/编排/产物）都挂 `workspace_id`，靠 `WHERE workspace_id` 隔离。前端硬编码 `WORKSPACE_ID=1`。没有 User 表，auth 是桩（user_id 从 token 取，缺失默认 `"1"`，不验签）。没有权限/ACL。

**想要**：像 vibe coding 那样——一个用户能有**多个工作空间（项目）**、能新建/切换；**你的团队（员工含总管）+ 技能 + 对话历史跟着你(用户)走**，不被某个工作空间绑死；工作空间瘦身成"**项目目录**"。

## 2. 核心模型（已与用户敲定）

**治理规则**：
- **用户级（跟你走，跨所有工作空间共享）**：`Employee`（含总管 is_curator）、`EmployeeSkill`、`EmployeeMcp`、`SkillRating`、`Conversation`（对话历史）。
- **工作空间级（每个项目自己的）**：产物/文件目录（SP2 细化）、"干活记录"的归属标记。
- **干活记录**（`EmployeeTask` / `OrchestrationPlan` / `TaskExecutionLog`）：随对话（用户级）出现在你的历史里，但带 `workspace_id` 标记"这次活为哪个项目干、产物落哪"。
- **Conversation 同时带 `user_id`（所有者→进你的历史）和 `workspace_id`（钉在哪个项目→产物/资源去哪）**。侧边栏按 `user_id` 列你**所有项目**的对话，每条标注其项目；点开 → 激活其工作空间。

**离线 = 隐式单用户**：不做两套模型。`user_id` 永远有值——取不到（离线/无 token）就落到固定本地用户（复用现状默认 `"1"`，或常量 `LOCAL_USER_ID`）。离线即"用户数=1"的退化：无登录/无用户切换，但**工作空间切换照常**。不写离线特判。

**身份**：复用现有 `user_id`（字符串，token 里取）。**不新建 User 表、不动 auth、不做权限**（B 推迟）。

## 3. 数据模型改动

| 模型 | 改动 |
|---|---|
| `Employee` | 加 `user_id`（迁移自所属 workspace 的 user_id）；查询改按 `user_id` 过滤。`workspace_id` 废弃（保留列但不再用作过滤，或后续删；实现期定）。 |
| `EmployeeSkill` / `EmployeeMcp` / `SkillRating` | 加 `user_id`（跟所属员工）；查询按 `user_id`。 |
| `Conversation` | 加 `user_id`（所有者）；**保留** `workspace_id`（钉的项目）。列表查询改按 `user_id`（+ 可选 workspace 过滤，见 §6）。 |
| `EmployeeTask` / `OrchestrationPlan` / `TaskExecutionLog` | 不动结构（已带 `workspace_id`）。它们经 conversation/employee 关联到用户；`workspace_id` 继续表示"产物归属项目"。 |
| `Workspace` | 仍有 `user_id`（拥有者）、`name`、`root_path`。语义从"装一切的容器"变为"**用户的一个项目（目录）**"。一个 user_id 可有多行（多项目）。 |

迁移用 `init_db` 的 `ensure_column` 加列；回填脚本：`Employee.user_id ← 其 workspace.user_id`、`Conversation.user_id ← 其 workspace.user_id`，等。现状单用户数据全在 workspace #1，平移到该 owner（缺失→本地默认用户）。

**约束/级联/FK 必须一并处理（评审发现，否则迁移即坏）**：
- **`Employee` 唯一约束**：现状 `UNIQUE(workspace_id, employee_code)` → 改为 `UNIQUE(user_id, employee_code)`。SQLite 不能 ALTER CONSTRAINT，需**重建表**（建新表→拷数据→换名）。实现期作为专门一步。
- **`Workspace → employees / conversations` 的 ORM 级联删除必须去掉**：现状 `cascade="all, delete-orphan"` 会在删工作空间时**连带删掉用户级的员工/会话**——SP1 后这是数据灾难。删工作空间只删 workspace 级记录（任务/执行日志/编排计划 + 目录），**绝不**碰员工/技能/会话。
- **`Employee → Workspace` 的 FK**：员工不再属于某 workspace。决定（实现期）：去掉该 FK / 置空 / 保留列但无 FK 无级联。**倾向去 FK（员工独立于 workspace）**。
- **`EmployeeSkill` / `EmployeeMcp` / `SkillRating` 的 `workspace_id` FK（`ondelete=CASCADE` 指向 workspaces）必须解除**：否则删工作空间会级联删掉用户的技能/外接/评分。改为跟随**员工**（user 级）级联，不跟 workspace。

## 3.5 总管/编排机器适配（评审发现的最大耦合点，必须处理）

总管是 user 级员工，但我们这套编排机器（QA/DAG/返工/事件）大量以 `workspace_id` 为键。拆分原则：**"列我的团队"按 user_id;"协调某项目的活/产物/事件"按 workspace_id。**

- **`build_employee_capability_context(db, workspace_id)`**：现状查 `Employee.workspace_id == workspace_id` 列总管可派的员工——员工改 user 级后这会**查到 0 个**。**改为按 `user_id` 查**（用 `conversation.user_id`，即对话所有者的团队）。总管构建处 `get_orchestrator_agent(...)` 须把 `user_id` 传进来（从 conversation 取）。
- **`WorkspaceEventBus.push(workspace_id, ...)` 保持 workspace 级**：任务在某项目里跑、产物落该项目、前端面板按激活项目订阅——事件通道**仍按 workspace_id**，正确不变。
- **任务协调**（`dependency_scheduler` / `on_employee_task_completed` / `trigger_incremental_report` / 放行闸 / 返工作废）**仍按 workspace_id**：它们协调的是"某项目内的活"，workspace_id 是对的。但其中"构建总管 agent"的地方要补 `user_id`（列团队用）。
- **`ensure_curator_conversation(workspace_id)`**：现状按 `workspace_id` 找总管 + 找/建总管会话。改为:总管按 `user_id` 找(用户唯一总管);总管会话 = `(user_id, workspace_id)` 即"我在这个项目的总管对话"——保留 workspace_id(钉项目),所有者 user_id。
- **`employee_mutations` 里 `employee.workspace_id != workspace_id` 的鉴权校验**：改为 `employee.user_id != current_user_id`(改删自己的员工)。
- **一句话**:凡"列/改员工(团队)"→ user_id;凡"派活/事件/产物/执行记录(项目内协调)"→ workspace_id。总管 agent 同时知道两者(user_id 列团队、active workspace_id 派活落产物)。

## 4. 工作空间生命周期（瘦身成项目）
- **新建**：`POST .../workspaces`（name）→ 在 `~/.digital-employee/<id-or-slug>/` 建目录 + 写 `Workspace` 行（user_id=当前用户，root_path=该目录）。**新建 = 空项目**：不播种员工（团队是用户级、已存在）、也**不播种任务**（任务是项目级、新项目本就该空，你在里面干活才产生任务）。原 `ensure_workspace_initialized` 里的 `sync_workspace_tasks` 是"重算已有任务 next_run_at"，新空项目无任务→无操作,不在新建路径调。
- **列出**：`GET .../workspaces`（按当前 user_id）→ 该用户的所有项目。
- **切换**：前端选中某 workspace → 之后请求带 `X-Workspace-Id`（已有中间件支持）；后端用它作"当前激活项目"。
- **删除**：删 `Workspace` 行 + 其目录 + 其 workspace 级记录（任务/执行日志/编排计划）。**不删**员工/技能/会话（用户级）。
- **默认激活**：请求无 `X-Workspace-Id` 时 → 该用户最近活跃/第一个工作空间;若一个都没有 → 自动建一个默认项目。

## 5. 播种改 per-用户
- 现状：每新建 workspace 播种一套员工/总管/任务。
- 改为：**首次见到某 user_id（无任何员工）时**，为该用户播种团队（总管 + 初始员工），一次性，跟用户走。
- 落点：`get_or_create_user_workspace` 拆成 `ensure_user_team`（播种员工，per-user，幂等，按 `Employee.user_id` 判存在）+ `ensure_user_default_workspace`（确保至少一个项目目录）。
- **启动顺序（评审发现，必须遵守）**：`ensure_column`(加 user_id 列) → **回填**(`Employee.user_id ← workspace.user_id` 等) → 才能跑 `ensure_user_team` 的"按 user_id 查员工"。否则迁移前老用户按 user_id 查到 0 员工 → **误触发重复播种**。回填须在任何 ensure_user_team 之前、随 init_db 一次性跑。

## 6. 查询过滤规则（关键，量大）
- **员工/技能/会话列表** → `WHERE user_id == <current user>`（不再 workspace_id）。
- **对话侧边栏** → 当前 user 的所有对话（跟人走）。是否再按当前激活 workspace 过滤：**默认不(显示跨项目全部、每条标项目)**，符合 ii；若日后想"只看当前项目对话"再加可选过滤。
- **任务/执行日志/编排** → `WHERE workspace_id == <active>`（项目级），或经 conversation 串到用户——视面板用途（员工任务面板按当前激活项目；总管对话内的执行记录跟对话）。
- 所有当前用 `workspace_id` 过滤员工/会话的端点都要改为 `user_id`——**这是改动量最大的一处**，需逐一排查（employee_service / chat_service / 各 list 端点）。

## 7. 前端
- 去掉 `WORKSPACE_ID=1` 硬编码 → 改为"当前激活 workspace"（前端本地持久化 last-active，经 `X-Workspace-Id` 发；无则后端给默认）。
- **工作空间切换器** UI：列出/新建/切换/（删）。离线也显示（单用户多项目）。
- 对话历史侧边栏：改为按用户(后端已改)，每条标注项目;点开切到其项目。
- 员工/技能列表:不再传 workspace_id(后端按 user_id)。

## 8. 非目标（SP1 不做）
- **权限/ACL/跨用户隔离（B）**——在线多用户的真隔离推迟;SP1 只做"资源按 user_id 归属 + 过滤",不做"防止 A 访问 B 的资源"的强校验（auth 是桩,本就没真隔离）。
- **产物统一进项目目录、可移植（C）** → SP2。
- **沙箱/越狱授权** → SP3。
- **真 auth/登录改造** → 不动。

## 9. 风险
- **大迁移 + 大面积过滤改写**：员工/会话的 workspace_id→user_id 触及很多查询;需穷尽排查，逐个改 + 回归。建议实现期先列"所有按 workspace_id 过滤 employee/conversation 的位置"清单。
- **分阶段实施(评审 R1)**：本 SP1 含 5 个独立关注点——(a) 加列+回填、(b) 约束重建(Employee 唯一键)、(c) 级联/FK 解耦(Workspace→员工/技能不级联)、(d) 查询过滤改写(8+ 服务)、(e) 总管/编排适配(§3.5)。plan 须**逐阶段、每阶段后全测过**再进下一阶段(基线 5 failed 不增),降低回归风险。建议顺序:加列回填 → 级联/约束 → 总管适配 → 查询过滤 → 多空间CRUD/切换 → 前端。
- **前端去硬编码**:`WORKSPACE_ID=1` 散在 6 个文件,但中心抽象在 `lib/workspace-id.ts` 的 `DEFAULT_WORKSPACE_ID`——从这里改成"当前激活 workspace"为主,顺藤摸瓜改各 api/lib 消费点 + 加切换器 UI。
- **Employee.workspace_id 废弃的处理**：直接删列 vs 保留但不用——保留更安全(additive)、删更干净。实现期定;倾向保留+停用,后续清理。
- **激活 workspace 的来源**：前端 last-active + 后端默认。需保证"无激活态"时不报错(给默认项目)。
- **离线/在线统一**:`user_id` 缺失→本地默认,必须在所有取 user 的入口一致(复用 request_utils 现有默认)。
- **现有 5 failed 后端基线 / 前端 typecheck 90 / vitest 1 failed**:改后零新增。

## 10. 验收对照
- 一个用户能新建/切换多个工作空间(项目);切换不影响他的团队(总管/员工)与对话历史(跟人走、跨项目可见、每条标项目)。
- 新建工作空间只建目录、不重复播种员工。
- 离线版:无登录、单隐式用户、照样多工作空间。
- 产物落在当前激活项目的目录(SP2 进一步整体可见)。
