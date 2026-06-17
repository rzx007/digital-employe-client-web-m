# 多工作空间 + 团队/对话用户级（SP1）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. **分 5 阶段,每阶段全测过(后端基线 5 failed 不增、前端 typecheck 90)再进下一阶段。**

**Goal:** 把工作空间从「1:1 绑用户的容器」改成「用户可拥有多个的项目目录」;员工/技能/会话/评分改挂 `user_id`(跟用户走、跨项目共享),任务/执行记录仍 `workspace_id`(项目级);总管「列团队」按 user_id、「派活/事件/产物」按 workspace_id。

**Architecture:** 加 `user_id` 列 + 回填 → 解耦级联/约束 → 总管编排适配 → 查询过滤改写 → 多空间 CRUD/切换 + 前端。离线 = 隐式单用户(user_id 缺失→本地默认)。权限(B)/产物目录(C)/真 auth 推迟。

**Tech Stack:** Python FastAPI + SQLAlchemy(`uv`)、React 19 + TS。

**关联 spec:** [docs/superpowers/specs/2026-06-17-multi-workspace-user-level-design.md](../specs/2026-06-17-multi-workspace-user-level-design.md)

**基线:** 后端 `cd apps/server && uv run pytest -q` → 5 failed / 598 passed;前端 typecheck `cd apps/web && npx tsc -p tsconfig.app.json --noEmit` → 90;vitest 1 failed。每阶段后确认零新增。

**⚠️ 这是大迁移。每个 Task 后必跑全量后端套件确认零新增失败,再继续。**

---

## 触点清单(实现期照此穷尽改写;来自代码探查)

**按 workspace_id 过滤、须改 user_id 的站点(B 的机械工作):**
- `Employee.workspace_id`(7):prompts.py:143、employee_service.py:835、task_service.py:362/559/642/675/729
- `EmployeeSkill.workspace_id`(4):employee_service.py:257/1081/1155、task_scheduler_service.py:351
- `Conversation.workspace_id`(3):chat_service.py:225(list_conversations)/542(ensure_curator_conversation)、recent_contact_service.py:65
- **保持 workspace_id 不动**:EmployeeTask/TaskExecutionLog/OrchestrationPlan 的过滤(task_service.py:502、orchestration_api.py:143)、RecentContact(它是"项目内最近联系",保持 workspace 级)、所有 `WorkspaceEventBus.push(workspace_id,...)`、employee_mutations 的归属校验改为 user_id。

**模型约束/级联(A,Phase 1 处理):**
- Employee:`UniqueConstraint(workspace_id, employee_code)`→`(user_id, employee_code)`(建表重建);`workspace_id` FK ondelete CASCADE → 去 FK/去级联;`Workspace.employees` 与 `Workspace.conversations` 的 `cascade="all, delete-orphan"` → **去掉**。
- EmployeeSkill/EmployeeMcp/SkillRating:`workspace_id` FK(CASCADE 指向 workspaces)→ 解除,跟员工级联即可。

**编排(D,Phase 3):** `build_employee_capability_context(db, workspace_id)`→按 user_id;`get_orchestrator_agent(workspace_id,...)` 加 `user_id` 参数(4 个调用点:chat_service.py:707/1217、task_scheduler_service.py:688、reentry.py:29);`ensure_curator_conversation` 按 user_id 找总管、会话存 (user_id, workspace_id)。

**前端(E,Phase 5):** `lib/workspace-id.ts` 已有 `getActiveWorkspaceId()` + `request.ts` 已注入 `X-Workspace-Id`。硬编码 `WORKSPACE_ID=1` 散在 5 文件 ~35 处(conversation.ts、employee.ts、use-schedule-monitor-queries.ts、workbench/*)→ 改用 `getActiveWorkspaceId()`。

---

## Phase 1 — Schema 地基(加列 + 回填 + 去级联/约束)

> 目标:数据模型就位,行为不变(查询仍按 workspace_id,但 user_id 已回填、级联已拆)。每步后全量测。

### Task 1.1: 加 `user_id` 列 + 回填(init_db)
**Files:** `apps/server/src/models/{employee,employee_skill,employee_mcp,skill_rating,conversation}.py`(加 `user_id` Mapped 列)、`apps/server/src/db/init_db.py`(ensure_column + 回填)、Test: `apps/server/tests/test_workspace_userlevel_migration.py`(Create)

- [ ] **Step 1: 写失败测试**——回填后:某 workspace(user_id="u1")下的 Employee/Conversation 的 `user_id` == "u1"。
```python
def test_backfill_sets_user_id_from_workspace(db_session):
    from src.models.workspace import Workspace
    from src.models.employee import Employee
    from src.models.conversation import Conversation
    from src.db.init_db import backfill_user_id  # 待实现
    ws = Workspace(name="w", root_path="/tmp/w", user_id="u1"); db_session.add(ws); db_session.flush()
    e = Employee(workspace_id=ws.id, name="e", employee_code="c"); db_session.add(e)
    c = Conversation(workspace_id=ws.id, target_type="curator", target_id=e.id); db_session.add(c)
    db_session.commit()
    backfill_user_id(db_session)
    db_session.expire_all()
    assert db_session.get(Employee, e.id).user_id == "u1"
    assert db_session.get(Conversation, c.id).user_id == "u1"
```
- [ ] **Step 2:** 跑确认失败。
- [ ] **Step 3:** 模型加 `user_id: Mapped[str | None] = mapped_column(Text, nullable=True, index=True)` 到 Employee/EmployeeSkill/EmployeeMcp/SkillRating/Conversation。init_db `ensure_column(...)` 加这 5 列(`<table>` user_id TEXT)。写 `backfill_user_id(db)`:对每个 workspace,`UPDATE <table> SET user_id = <workspace.user_id> WHERE workspace_id = <ws.id> AND user_id IS NULL`(employee/employee_skill/employee_mcp/skill_rating/conversation 各一)。init_db 启动序列里**在任何 ensure_user_team 之前**调 `backfill_user_id`。
- [ ] **Step 4:** 跑确认通过 + 全量(5 failed/599)。
- [ ] **Step 5:** Commit `feat(workspace): 员工/技能/会话 加 user_id 列 + 启动回填`。

### Task 1.2: 去掉 Workspace→员工/会话 的级联删除 + 解耦 FK
**Files:** `apps/server/src/models/workspace.py`(去 `cascade="all, delete-orphan"`)、`employee.py`/`employee_skill.py`/`employee_mcp.py`/`skill_rating.py`(workspace_id FK → 去 FK 或去 ondelete CASCADE,保留普通列)、Test 同文件。

- [ ] **Step 1: 写失败测试**——删一个 workspace **不**删其下员工/会话(它们已挂 user)。
```python
def test_delete_workspace_keeps_user_resources(db_session):
    # seed ws + employee + conversation(都回填 user_id),删 ws 行,断言 employee/conversation 仍在
    ...
```
- [ ] **Step 2:** 跑确认失败(现状级联会删掉)。
- [ ] **Step 3:** `workspace.py`:`employees`/`conversations` relationship **去掉** `cascade="all, delete-orphan"`(改为无级联,或 `passive_deletes`)。员工/技能/外接/评分的 `workspace_id` 列:**去掉 `ForeignKey(..., ondelete="CASCADE")`**,保留为普通可空整数列(`workspace_id: Mapped[int | None]`)——它们不再受 workspace 删除牵连。注:SQLite 改 FK 需建表重建(见 Task 1.3 同款手法);若 ensure_column 加的新表无此 FK 也行——实现期确认现有表的 FK 是否实际生效(SQLite 默认 `PRAGMA foreign_keys` 未必开;若未开则 ORM 级联是主要风险,去 relationship cascade 即足够)。**先查 `PRAGMA foreign_keys`**:若 OFF,则只需去 ORM relationship 级联(简单);若 ON,才需建表重建去 FK。
- [ ] **Step 4:** 跑确认通过 + 全量。
- [ ] **Step 5:** Commit `feat(workspace): 解除 Workspace→员工/会话/技能 的级联删除`。

### Task 1.3: Employee 唯一约束 `(workspace_id, employee_code)` → `(user_id, employee_code)`
**Files:** `apps/server/src/models/employee.py`、`apps/server/src/db/init_db.py`(建表重建 helper,仿 `_migrate_task_id_nullable`)、Test 同文件。

- [ ] **Step 1: 写失败测试**——同一 user 下不能有两个相同 employee_code;不同 user 可以。
- [ ] **Step 2:** 跑确认失败。
- [ ] **Step 3:** 模型 `UniqueConstraint("user_id", "employee_code", name="uq_user_employee_code")`。init_db 写 `_migrate_employee_unique_key()`(仿 init_db.py:253 的 `_migrate_task_id_nullable` 表重建套路:建新表带新唯一键 → 拷数据 → drop 旧 → rename),在回填之后调。
- [ ] **Step 4:** 跑确认通过 + 全量。
- [ ] **Step 5:** Commit `feat(workspace): Employee 唯一键改 (user_id, employee_code) + 建表迁移`。

---

## Phase 2 — 播种改 per-用户

### Task 2.1: `ensure_user_team`(per-user 播种)+ 新建空工作空间
**Files:** `apps/server/src/service/workspace_service.py`、`apps/server/src/service/employee_service.py`(seed 按 user_id)、Test。

- [ ] **Step 1: 写失败测试**——`ensure_user_team(db, "u1")` 给 u1 播种总管 + 内置员工(都挂 user_id="u1"),幂等(再调不重复);新建 workspace **不**播种员工。
- [ ] **Step 2:** 跑确认失败。
- [ ] **Step 3:**
  - `employee_service`:`ensure_curator_employee` / `ensure_builtin_seed_employees` 改为按 `user_id` 判存在 + 播种(新员工挂 user_id,workspace_id 留空/默认)。
  - `workspace_service`:`get_or_create_user_workspace` 拆出 `ensure_user_team(db, user_id)`(per-user 播种,回填之后)+ `ensure_user_default_workspace(db, user_id)`(确保至少一个项目目录)。`ensure_workspace_initialized` **不再**播种员工/任务(新建=空项目)。
- [ ] **Step 4:** 跑确认通过 + 全量 + 启动一次(`uv run python -c "from src.db.init_db import init_db"` 或等价)确认迁移+播种顺序不报错。
- [ ] **Step 5:** Commit `feat(workspace): 播种改 per-用户(ensure_user_team)+ 新建工作空间为空项目`。

---

## Phase 3 — 总管/编排适配(§3.5)

### Task 3.1: `build_employee_capability_context` 按 user_id 列团队 + `get_orchestrator_agent` 加 user_id
**Files:** `apps/server/src/service/agent/orchestrator/prompts.py`、`apps/server/src/service/agent/orchestrator/agent.py`(get_orchestrator_agent 加 `user_id` 参数)、4 个调用点(chat_service.py:707/1217、task_scheduler_service.py:688、reentry.py:29)、Test。

- [ ] **Step 1: 写失败测试**——`build_employee_capability_context(db, user_id="u1")` 列出 u1 的员工(跨其多个 workspace 共享);不同 user 的员工不串。
- [ ] **Step 2:** 跑确认失败。
- [ ] **Step 3:** `build_employee_capability_context` 签名加/改用 `user_id`,查询 `Employee.user_id == user_id`。其中"活跃定时任务"列仍可按 workspace(实现期定:列团队的任务概览可省/或按当前激活 workspace)。`get_orchestrator_agent` 加 `user_id: str | None`,传入 `build_employee_capability_context`。4 个调用点把 conversation 的 user_id 传进来(curator 对话有 user_id)。
- [ ] **Step 4:** 跑确认通过 + 不变量门 + 全量。
- [ ] **Step 5:** Commit `feat(orchestrator): 总管按 user_id 列团队(get_orchestrator_agent 加 user_id)`。

### Task 3.2: `ensure_curator_conversation` 按 user_id + employee_mutations 鉴权改 user_id
**Files:** `apps/server/src/service/chat_service.py`(ensure_curator_conversation)、`apps/server/src/service/agent/orchestrator/employee_mutations.py`、`tools/employees.py:70`、Test。

- [ ] **Step 1: 写失败测试**——`ensure_curator_conversation(db, user_id="u1", workspace_id=ws)` 找到 u1 的总管、会话行带 (user_id=u1, workspace_id=ws);employee_mutations 删别人 user 的员工被拒。
- [ ] **Step 2:** 跑确认失败。
- [ ] **Step 3:** `ensure_curator_conversation` 改签名带 user_id:`ensure_curator_employee` 按 user_id 找;会话查 `(user_id, workspace_id, target_type='curator')`,新建时写 user_id+workspace_id。`employee_mutations`/`tools/employees.py` 的 `employee.workspace_id != workspace_id` 校验改 `employee.user_id != current_user_id`(current_user_id 从上下文/agent 取)。
- [ ] **Step 4:** 跑确认通过 + 全量。
- [ ] **Step 5:** Commit `feat(orchestrator): 总管会话/员工鉴权改按 user_id`。

---

## Phase 4 — 查询过滤改写(employee/skill/conversation → user_id)

> 把"触点清单 B"里 employee/skill/conversation 的 workspace_id 过滤逐站改 user_id。**逐文件一个 Task,每个 Task 后全量测。**

### Task 4.1: employee_service 改 user_id 过滤
**Files:** `apps/server/src/service/employee_service.py`(list_employees:835、list_skill_assignees:257、_replace_employee_skills:1081、skill 校验:1155 等)、Test。
- [ ] 写测试(list_employees(user_id) 返回该用户全部员工跨空间);改这些查询 `workspace_id` → `user_id`(入参从 workspace_id 改/补 user_id——上游 API 传 user_id);跑全量;Commit。

### Task 4.2: task_service / task_scheduler 的 employee/skill 查询改 user_id
**Files:** `task_service.py:362/559/642/675/729`、`task_scheduler_service.py:351`。**注意区分**:这些函数里"找员工/技能"改 user_id,"任务/执行记录"保持 workspace_id。逐处改 + 测 + Commit。

### Task 4.3: 会话列表/侧边栏改 user_id
**Files:** `chat_service.py:225` `list_conversations`、`_validate_target`、对话列表端点、`recent_contact_service.py:65`。
- [ ] `list_conversations` 改为按 `user_id`(+ 可选 target 过滤);侧边栏端点传 user_id(从请求)。RecentContact 保持 workspace 级(项目内最近联系)——除非产品要跟人,这里**保持不动**(spec §6:对话跟人,最近联系按项目)。测 + Commit。

---

## Phase 5 — 多空间 CRUD/切换 + 前端

### Task 5.1: 工作空间 CRUD API(列/建/删)+ X-Workspace-Id 校验归属
**Files:** `apps/server/src/api/workspace_api.py`(或现有)、`request_utils.py`(X-Workspace-Id 校验属当前 user,否则回落默认)、Test。
- [ ] `GET /workspaces`(当前 user 的项目列表)、`POST /workspaces`(建目录+行,空项目)、`DELETE /workspaces/{id}`(删行+目录+其 workspace 级记录,不删员工/会话)。`get_workspace_id_from_request`:X-Workspace-Id 存在时校验 `Workspace.user_id == current_user`,不匹配→回落该 user 默认空间。测 + Commit。

### Task 5.2: 前端去硬编码 + 工作空间切换器
**Files:** `apps/web/src/api/{conversation,employee}.ts`、`hooks/use-schedule-monitor-queries.ts`、`lib/workbench/*` —— `WORKSPACE_ID=1` → `getActiveWorkspaceId()`;新增 workspace 列表/切换器 UI(挑现有侧边栏/设置区落点);切换写 `getActiveWorkspaceId` 的来源(auth store + localStorage)→ `request.ts` 已自动注入 `X-Workspace-Id`。对话历史侧边栏:后端已改 user_id,前端展示每条所属项目。
- [ ] typecheck 90 基线、vitest 基线;format;Commit(可拆多个小 Commit)。

### Task 5.3: 端到端自检 + 最终集成评审
- [ ] 后端全量 5 failed/基线;前端 typecheck 90/vitest 1 failed;最终集成评审(整盘 SP1);人工冒烟:新建/切换多工作空间、团队与对话跟人走、新空间不重播种、删空间不丢团队、离线单用户照常。

---

## 风险与注意
- **每阶段 test-gate**:任一 Task 后全量后端套件必须仍 5 failed(零新增),前端 typecheck 90。出现新失败先修再进。
- **`PRAGMA foreign_keys` 是否开**:决定 Task 1.2 是"只去 ORM 级联(简单)"还是"建表去 FK(重)"。实现期先查。
- **Employee.workspace_id 列**:保留为普通可空列(停用),不强删(additive 更安全);后续清理另说。
- **current_user_id 的来源**:服务层很多函数现在只收 workspace_id;Phase 3/4 需把 user_id 透传进来(从请求/agent 上下文)。这是改动量集中点,逐函数补参数。
- **离线**:`user_id` 永远有值(request_utils 默认 "1");所有新 user_id 入口对齐该默认,不写离线特判。
- **不做权限强隔离(B)**:X-Workspace-Id 校验只是"回落",非 403;真隔离推迟。
