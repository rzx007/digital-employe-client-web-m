# 阶段 4：旧系统退场（群专属编排 + 员工单聊入口）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development。Steps 用 checkbox。
> 上游：总管中心重构总览 阶段4；红线⑥"退场放最后"。基底 `feat/orchestrator-centric`（阶段1/2/3 完成）。

**Goal:** 删群专属编排(组长/成员直派/房间账/工具/API/前端) + 员工单聊入口退场(点员工→只读成长面板)。让总管中心成为唯一系统。**绝不打断**已建好的总管派活/再入/共享桌/学习闭环。

**Architecture:** 按"安全退场顺序"：① 后端**解耦**(从 reentry/execution/dependency_scheduler/stream_registry/resource_service/chat_service 摘掉群钩子，群代码暂留但失活) → ② 后端**删群代码**(tools/groups/group_room_service/group_service/models/group_api/群测试) → ③ 前端删群 → ④ 前端员工点击转只读成长面板。每步 grep 零引用 + 测试门。**纯删除/解耦，无新功能。**

**Tech Stack:** 后端 Python/pytest(uv)；前端 React/typecheck(pnpm，node_modules 已装)。

---

## 设计要点（实现前必读，依据依赖勘探）

**勘探确认**：删群后总管中心路径**完全独立**（派活 execution 非群、再入 reentry 非群、调度 dependency_scheduler 非群分支、共享桌 agent.py、学习闭环 均不依赖群）。

**关键解耦点（删群代码前必须先摘，否则共享代码 import 崩）**：
- `reentry.py:106-110`：删 GroupRoom 群判断（改为仅 `plan.status=="summarized"` 幂等，所有计划走再入）。
- `execution.py:66-88` `_resolve_room_shared_artifacts_dir`：改为恒返回 None（派活回落共享桌/员工目录）。
- `dependency_scheduler.py:402 + 416-441`：删 `_trigger_leader_summary_if_room` 调用 + 函数定义（仅留 `trigger_orchestrator_reentry`）。
- `stream_registry.py:~2340-2354`：删 group_room_service 导入 + 群回调块(unregister_group_stream_relay/project_member_conversation_if_in_room/auto_confirm_leader_plan_if_pending)。
- `resource_service.py:144/204/225/259`：群相关(`_resolve_room_id_for_conversation`/`resolve_shared_artifacts_dir`)→恒 None/删。
- `chat_service.py`：`handle_group_message` 分支删/404。

**安全纪律**：
- **解耦先于删除**：先摘所有对群代码的 import/调用，再删群文件。
- **每删一批 grep 零引用**：`grep -rn "GroupRoom\|group_room_service\|create_group_and_dispatch\|handle_group_message" apps/server/src` 应清零(除将删的文件自身)。
- **测试门**：后端每任务后跑全量 pytest，确认仅预存基线失败、且**总管中心相关测试(orchestrator/reentry/journal/signal/librarian/desk/growth)全绿**。群测试在删群代码时一并删。
- 前端每任务后 `pnpm --filter digital-employee typecheck` exit 0。

**文件结构**（删除为主）：见各任务。

---

## Task 1（后端解耦）：从共享代码摘掉群钩子

**Files:** Modify `reentry.py`、`execution.py`、`dependency_scheduler.py`、`stream_registry.py`、`resource_service.py`、`chat_service.py`（均 apps/server/src/service 或 service/agent/orchestrator）

- [ ] **Step 1: 改 reentry.py**（删群判断）
  现 `trigger_orchestrator_reentry`(~L97+) 开头查 GroupRoom、`if room is not None: return None`。删这段 GroupRoom 查询与 import，保留 `plan.status=="summarized"` 幂等 + conv 存在守卫 + 后续再入逻辑不变。

- [ ] **Step 2: 改 execution.py**（共享目录恒 None）
  `_resolve_room_shared_artifacts_dir`(L66-88) 函数体改为 `return None`（删其对 resolve_shared_artifacts_dir 的 import/调用）。`start_task_as_conversation`(L420) 调用处保留(拿到 None 后走阶段1A 共享桌逻辑，已自洽)。

- [ ] **Step 3: 改 dependency_scheduler.py**（删群汇总分支）
  删 `_trigger_leader_summary_if_room` 调用(L402)与函数定义(L416-441)及其对 GroupRoom/GroupRoomService 的 import。all_settled 分支仅留 `trigger_orchestrator_reentry(db, plan, workspace_id)`。

- [ ] **Step 4: 改 stream_registry.py**（删群回调块）
  删 `~L2340-2354` 的 `from src.service.group_room_service import (...)` + `unregister_group_stream_relay`/`project_member_conversation_if_in_room`/`auto_confirm_leader_plan_if_pending` 调用。保留 `_capture_journal_safe`/`_reflect_on_signal_safe`/`_maybe_librarian_safe` + TaskExecutionLog 终态/再入触发。

- [ ] **Step 5: 改 resource_service.py**（群目录恒 None）
  `_resolve_room_id_for_conversation`/`resolve_shared_artifacts_dir`(L144/204/259 等) → 恒返回 None（删 GroupRoom/GroupRoomMember import 与查询）。`_read_roots`/`list_resources` 的 room_dir 分支自然失活(room_dir 恒 None)。

- [ ] **Step 6: 改 chat_service.py**（群消息入口删）
  `handle_group_message` 及其调用点(若前端/路由调用)删除或改 404。grep 确认调用方(group_api 会在 Task2 删；若其它处调用，一并处理)。

- [ ] **Step 7: 验证（不删群文件，仅解耦）**
  ```
  cd apps/server && uv run pytest tests/ -q
  ```
  Expected：群测试可能因解耦失败(预期，Task2 删它们)；但**总管中心测试必须全绿**：
  ```
  uv run pytest tests/ -k "orchestrator_desk or reentry or journal or signal_critic or librarian or growth or dependency_scheduler" -v
  ```
  全绿(dependency_scheduler 的群级联测试若挂=预期，本步只保非群)。记录哪些群测试因解耦挂(Task2 删)。

- [ ] **Step 8: 提交** `git commit -m "refactor(retire): 共享代码摘除群钩子（reentry/execution/scheduler/stream_registry/resource/chat_service）"`

> ⚠️ 本任务最关键：解耦后总管中心路径必须完整。若某非群测试挂，停下 systematic-debugging，不硬删。

---

## Task 2（后端删群代码）：删群服务/工具/API/模型/测试

**Files:** Delete `tools/groups.py`、`group_room_service.py`、`group_service.py`、`api/group_api.py`、`models/group_room.py`(+chat_group.py/group_member.py 视引用)、`tests/test_group_*.py`；Modify `orchestrator/agent.py`(删5工具注册)、`orchestrator/tools/__init__.py`(删re-export)、`api/__init__.py`或`server.py`(删group_router注册)、`models/__init__.py`(删群model导入)

- [ ] **Step 1: 删工具注册** `orchestrator/agent.py:312-349` 删 create_group_and_dispatch/list_workspace_groups/get_group/update_group/delete_group 五处；`orchestrator/tools/__init__.py:46-52,88-93` 删 re-export。
- [ ] **Step 2: 删路由注册** grep `group_api`/`group_router` 在 `api/__init__.py`或`server.py`，删 include_router。
- [ ] **Step 3: 删文件** `rm` tools/groups.py、group_room_service.py、group_service.py、api/group_api.py。
- [ ] **Step 4: 删模型**（先 grep 确认无残留引用）`grep -rn "GroupRoom\|GroupRoomMember\|ChatGroup\|group_member" apps/server/src` 应仅剩 models 自身。删 models/group_room.py(+chat_group.py/group_member.py)，删 `models/__init__.py` 里它们的导入/导出。注意 Conversation 等无 FK relationship 指向群模型残留(有则一并清)。
- [ ] **Step 5: 删群测试** `rm tests/test_group_*.py`（test_group_tools.py/test_group_leader_clarification.py 等）；grep `GroupRoom\|create_group\|group_room_service` 在 tests/ 清其它残留 setup。
- [ ] **Step 6: 验证零引用 + 全量**
  ```
  grep -rn "group_room_service\|GroupRoom\|create_group_and_dispatch\|handle_group_message\|group_api" apps/server/src   # 应清零
  cd apps/server && uv run pytest tests/ -q   # 仅预存基线失败、无 import 错、无新增回归
  ```
- [ ] **Step 7: 提交** `git commit -m "refactor(retire): 删群专属编排(服务/工具/API/模型/测试)"`

---

## Task 3（前端删群）

**Files:** Delete `apps/web/src/components/chat/group/*`、`api/group*.ts`(group.ts/group-room.ts)、群 message-blocks(group-created-card 等)/dialogs(create-group-dialog 等)；Modify `chat-view.tsx`(删 group 分支)、contacts-sidebar(删群分组)、其它 group import 点

- [ ] **Step 1: 删 chat-view.tsx 群分支** 删 `contact?.type === "group"` → GroupRoomView 整段(L189-208)。
- [ ] **Step 2: 删群组件/api/卡片/对话框** `rm -r components/chat/group/`；删 api/group*.ts、group-created-card、create-group-dialog 等。grep `from.*group` 清残留 import。
- [ ] **Step 3: 删群分组 UI** contacts-sidebar.tsx 删 groupContacts 分区(L94-102 群分类 + 展示段)；contact 类型/数据源(api/chat.ts fetchContacts)删 groups 拼接。
- [ ] **Step 4: typecheck 零错**
  ```
  grep -rn "group-room\|GroupRoom\|create-group\|api/group" apps/web/src   # 应清零(除可能保留的 metadata 概念)
  cd "..../orch-centric" && pnpm --filter digital-employee typecheck   # exit 0
  ```
- [ ] **Step 5: 提交** `git commit -m "refactor(retire): 前端删群(视图/组件/api/路由分支/侧栏分组)"`

> 注：群相关 use-workspace-events 的 room_* 事件类型若纯类型可留(无害)；以 typecheck 为准。`@` mention 链路(阶段③重定性)**保留不动**。

---

## Task 4（前端员工单聊→只读成长面板）

**Files:** Modify `chat-view.tsx`（employee 分支）、`chat-layout.tsx`(新建对话流)

- [ ] **Step 1: employee 点击转只读** `chat-view.tsx` 现 employee/默认分支(L210-229)渲 ConversationChatView/DraftChatView。改为：employee 类型(非 draft)→渲**只读成长面板**(复用 `GrowthBrainSection`，传 `employeeId=contact.employee?.id`；包一层标题/容器，体感)。**不再**渲 ConversationChatView(员工不可对话)。
  - 注意：保留 curator 走 CuratorView 不变；保留后台员工任务执行(走 registry，不经 ChatView，不受影响)。
- [ ] **Step 2: 新建对话流** `chat-layout.tsx` `handleNewConversation`(L265-272)：employee 类型不再建单聊会话，改为 noop/提示"请通过总管派活"(toast)或直接只对 curator 生效。
- [ ] **Step 3: 清理** 若 ConversationChatView/DraftChatView 删 employee 入口后**完全无引用**(群也删了)，可删；但**先 grep 确认零引用再删**(可能仍被别处用)。无把握则留着不删(无害)，报告说明。
- [ ] **Step 4: typecheck + 提交**
  ```
  cd "..../orch-centric" && pnpm --filter digital-employee typecheck   # exit 0
  ```
  `git commit -m "refactor(retire): 员工点击转只读成长面板，单聊入口退场"`

---

## 收尾验证
- [ ] 后端全量：`cd apps/server && uv run pytest tests/ -q`，仅预存基线、零新增回归、零 import 错。
- [ ] 后端零群引用：`grep -rn "group_room_service\|GroupRoom\|create_group_and_dispatch" apps/server/src` 清零。
- [ ] 前端 typecheck exit 0、零群引用(`grep -rn "group-room\|GroupRoom" apps/web/src`)。
- [ ] **整体手测(用户)**：总管组队→后台并行→再入整合→共享桌→面板见桌→学习闭环(失败重试反思/journal/profile)→成长面板履历→点员工只读不可聊→无群入口→旧群功能确实没了。

## 开放问题/风险
- O1 模型删除若有隐藏 FK/relationship 残留→pytest import/建表会报，按报错清。
- O2 chat_service handle_group_message 的前端调用方(若有)需同步处理(Task1 Step6 / Task3)。
- O3 ConversationChatView/DraftChatView 是否彻底删：本计划保守"无引用才删"，留着无害。
- O4 群历史数据(DB 里已有 group 会话/room)：删模型后这些行成孤儿(建表不再有该表)——单机桌面可接受;若在意，迁移/清库另议。
</content>
