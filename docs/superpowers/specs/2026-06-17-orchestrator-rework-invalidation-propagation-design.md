# 返工作废传播 + 返工 gate（rework invalidation propagation）— 设计 spec

- 日期：2026-06-17
- 分支：feat/orchestrator-centric
- 关联：[2026-06-16-orchestrator-qa-rework-design.md](2026-06-16-orchestrator-qa-rework-design.md)（一线质检 + 返工）、[2026-06-17-orchestrator-qa-dag-gating-design.md](2026-06-17-orchestrator-qa-dag-gating-design.md)（初次派发以接受为闸）

## 1. 背景与问题（冒烟取证）

DAG-QA gating 给**初次派发**装了"前置已 QA 接受才放行下游"的闸。但**返工路径绕过了这个闸**：`redispatch_task_in_session`（rework.py）做完上限校验/守卫后，**直接起返工流**（`_schedule_employee_rework_stream`），全程不查 DAG 依赖。

冒烟现象（偶发）：两任务都打回时，下游 B 的返工与上游 A 的返工**并行**进行，B 用 A 的旧（被否决）数据返工——依赖性又丢了。偶发是因为"总管是否在一轮里同时返工有依赖的两个任务"是 LLM 判断、非确定。

**同源的第二个洞**：返工上游 A 后，下游 B **不会自动重跑**——A 的接受作废了，但 B 早已基于旧 A 交付、无人触发它重来 → B 永久停在旧数据上。

**统一根因**：返工没有打通 DAG —— 既不 gate 自己的前置，也不作废/重跑自己的下游。上一特性只补了"初次派发"这一半。

## 2. 目标 / 非目标

### 目标
- **返工 gate**：返工某任务前，要求其前置已 QA 接受；否则拒绝。
- **作废传播**：返工某任务 X 时，递归作废 X 的**所有下游**（传递闭包）——它们基于旧产物的结果已失效；下游在 X 重新达标后由现有放行闸**自动重跑**（基于新数据从头做）。
- 与次序无关地消除"下游基于被返工上游的旧数据跑/交付"。

### 非目标
- **不**处理下游最新为 `failed`/`skipped` 的情形（这类未交付好产物；其 re-run 牵扯级联 un-skip，留后续）。本期作废只针对**已交付（success/completed）或在飞（running/queued/pending）**的下游。
- **不**改"X 自己被返工=原对话续聊改稿"（redispatch_task 既有行为）；作废后的下游重跑走**新会话**（输入变了、从头做，语义不同）。
- 前端无需改动（复用 superseded 状态显示）。

## 3. 设计

### 3.1 返工 gate（rework.py `redispatch_task_in_session`）
在现有守卫之后、**任何 mutation（打回旧 log / 计数）之前**，加前置检查：
- 取该任务的前置集合 `dep_ids`，若 `not _all_prereqs_accepted(dep_ids, _load_accepted_task_ids(db, dep_ids))` → **拒绝**并返回：
  「错误：任务「X」的前置尚未通过质检（或正在返工），请先处理前置；其下游会在前置重新达标后自动重跑。」
- 拒绝时**不消耗 `rework_count`**、不打回、不起流。
- 便利封装：`dependency_scheduler.task_prereqs_accepted(db, task) -> bool`（内部 load plan + build_dependency_maps 取 dep_map[task.id] → 查接受）。

### 3.2 作废传播（返工成功打回 X 后）
`redispatch_task_in_session` 在打回 X、起 X 返工流、**且 rework.py 自己的 `db.commit()` 之后**，调
`dependency_scheduler.invalidate_downstream(X.id) -> list[int]`（**自管独立 session**，与 `release_accepted_downstream` 一致——不复用 rework.py 的 db，避免 session 生命周期纠缠；它读到的是 rework 已提交的状态）：
1. 求 X 的**传递闭包下游** `succ_ids`（BFS over `build_dependency_maps` 的 `successors` 映射）。
2. 对每个下游 task：取其**最新一条 log**（id desc）：
   - 最新为 `success`/`completed`（已交付）→ 标 `superseded`，`run_result="上游返工，已作废待重跑"`。
   - 最新为 `running`/`queued`/`pending`（在飞）→ **先**标 `superseded`（同上 note）**并 commit**，**再** `ChatService.cancel_conversation_stream(log.conversation_id)` 取消在飞流。**次序关键**（见 §6）：先落 superseded 再取消，确保异步的取消善后不会覆盖。
   - 最新为 `superseded`/`failed`/`skipped` → 跳过（已非 live）。
3. 返回被作废的 task_ids（供日志）。
- **复用现成**：`successors` 映射来自 dependency_scheduler；取消在飞复用「中止运行中任务」的 `ChatService.cancel_conversation_stream`。

### 3.3 下游自动重跑（无新代码，复用放行闸）
作废后，下游最新 log 为 `superseded` → ① 不在"已接受"集（`_load_accepted_task_ids` 只认 success/completed）；② 不在 `_ALREADY_DISPATCHED_STATES`（superseded 不在其中）→ 视为"未派"。
待 X 返工完成 → 总管再评审接受 → 放行闸 `release_accepted_downstream` → `on_employee_task_completed(X)` → 派发分支发现下游前置（X）已接受、下游未派 → **经 `start_task_as_conversation` 新会话重跑**（`_collect_prereq_artifacts` 取 X 最新 success = 返工后的新产物）。传递闭包逐层流动（B 重跑达标→接受→放行→C 重跑）。

### 3.4 为何与次序无关（③(a) 的关键作用）
同轮总管同时返工 A、B：
- **先 A 后 B**：返工 A → 作废 B（B 若已交付→superseded；若在飞→取消+superseded）。再 redispatch(B)：B 的前置 A 不再接受 → **gate 拒绝**。
- **先 B 后 A**：redispatch(B) 起 B 返工流（此刻 A 仍接受、gate 过）。再返工 A → 作废 B 的下游闭包**含 B 自己的在飞返工流 → 取消 + superseded**。B 等 A 达标后重跑。
两序都收敛到"B 基于返工后的 A 重跑一次"。取消在飞（③(a)）是次序无关的关键——不取消则"先 B 后 A"漏。

### 3.5 prompt（总管）
「一线质检」段补一条：
> 返工只针对**出问题的那个任务**。返工一个任务会**自动作废并重跑它的所有下游**（下游基于旧产物的结果已失效）——**不要手动返工下游**，它会在该任务重新达标后自动重跑、再交你评审。若你想返工的任务其前置尚未达标/在返工，系统会拒绝（先处理前置）。

## 4. 数据 / 机制改动面（纯后端）
- `dependency_scheduler.py`：
  - `task_prereqs_accepted(db, task) -> bool`（返工 gate 用）。
  - `invalidate_downstream(task_id) -> list[int]`（传递闭包作废 + 取消在飞；自管独立 session）。
  - 复用现有 `build_dependency_maps`（successors）、`_load_accepted_task_ids`、`_all_prereqs_accepted`、放行闸。
- `rework.py` `redispatch_task_in_session`：起流前加 gate（3.1）；打回+起流后加 `invalidate_downstream`（3.2）。
- `prompts.py`：3.5 的 prompt 补充 + 不变量门断言。
- 复用 `ChatService.cancel_conversation_stream`（无改动）。
- 无新增列（复用 `superseded`）。

## 5. 测试策略
- **返工 gate**：前置未接受 → `redispatch_task_in_session` 拒绝、不消耗 rework_count、不打回、不起流；前置已接受 → 正常返工。
- **作废传播**：返工 X → 已交付下游 B（success+accepted）转 superseded；在飞下游（running）被取消（mock cancel）+ 转 superseded；传递闭包（A→B→C，返工 A 作废 B、C）；最新为 failed/skipped 的下游不动。
- **次序无关**：先 B 后 A 序——返工 A 作废并取消 B 的在飞返工。
- **重跑闭环**：作废 B 后，X 重新达标 → `release_accepted_downstream` → B 经放行闸可派（`_all_prereqs_accepted` 翻真）。
- **作废后可再派**（关键机制守护）：B 的 success log 被原地翻 `superseded` 后，`_already_dispatched(B)` 应为 **False**（superseded 不在 `_ALREADY_DISPATCHED_STATES`）——直接断言这点，守住"作废→可重派"通路。
- **prompt 不变量门**：新增"作废/下游自动重跑"关键词锚点。
- **基线**：后端 5 failed / 589 passed（+本特性新测试），零新增；前端不动。

## 6. 风险
- **取消在飞下游 vs finalize 覆盖（已查证、无需改 finalize）**：`_finalize_task_stream`（stream_registry.py:2352-2357）只更新 `run_status IN ("running","queued")` 的 log——一旦 invalidate 把该 log 标 `superseded`，finalize 的 SELECT 选不中、直接 `return` no-op。因此 §3.2 规定**先 commit superseded、再 cancel**：异步的取消善后跑到时该行已是 superseded，不会被改回 `cancelled`/`failed`。**不需要改 finalize**。（反序则有窗口：cancel 先触发 finalize 写 cancelled，再被 superseded 覆盖——虽最终也对，但先 superseded 更干净、无中间态。）
- **作废与放行的重入**：作废发生在返工 X 时；下游重跑发生在 X 再接受后的放行闸。两阶段不交叠，无环（每次接受一次性 qa_accepted_at）。
- **取消在飞下游的 conv.status 副作用（已知、可接受）**：`_finalize_task_stream` 第 1 步无条件把会话置 `idle`（在 log SELECT 之前），故被取消的下游会话会短暂显示 `idle`——**不影响 log 终态**（log 已是 superseded、SELECT no-op）与重跑路径，仅会话状态轻微不一致。属现有行为，本期接受不处理。
- **传递闭包规模**：计划内任务通常很少，BFS 成本可忽略。
- **下游 failed/skipped 不重跑**（非目标）：若上游返工后下游本应有机会成功，本期不自动 un-skip；如成痛点再做。

## 7. 验收对照
冒烟"两任务都打回"不再出现并行/依赖丢失：无论总管以何次序返工 A、B，B 最终只基于返工后的 A **重跑一次**；返工上游后下游自动作废并在上游达标后重跑。
