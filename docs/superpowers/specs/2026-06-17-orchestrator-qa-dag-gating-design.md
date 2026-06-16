# 下游派发以 QA 接受为闸（DAG-QA gating）— 设计 spec

- 日期：2026-06-17
- 分支：feat/orchestrator-centric
- 关联：[2026-06-16-orchestrator-qa-rework-design.md](2026-06-16-orchestrator-qa-rework-design.md)（总管一线质检 + 自主透明返工）

## 1. 背景与问题

上一特性让总管对员工交付做一线质检、不达标时 `redispatch_task` 返工。冒烟测试（热搜→生成 Word，Word 依赖热搜）暴露一个正确性 bug：

**文档基于「被否决的热搜数据」先行交付了。**

观察到的三条执行记录：热搜#1（已打回 superseded）、Word（成功，基于热搜#1 旧数据）、热搜返工（成功）。即下游 Word 在上游热搜还没通过质检时就被派发并交付，质检随后才把热搜打回返工——交付前后不一致。

## 2. 根因（已取证）

员工任务流终态化时，`_finalize_task_stream`（`stream_registry.py:2424` / `:2454`）**背靠背触发两个独立反应**：

```
on_task_finalized(...)        # → on_employee_task_completed → 立即派发下游后继
debouncer.notify(orch_conv)   # → 稍后唤醒总管 QA 评审
```

下游派发的门槛是 `dependency_scheduler.py` 的 `_all_prereqs_done`，依据 `_PREREQ_DONE_STATES = ("completed","success")`。即**「上游 success」被直接当作「依赖满足、可派下游」**——而此时 QA 还没评审。两个反应抢跑，DAG 永远先到。

**架构层面的根本矛盾**：一旦引入 QA，「任务 success」不再等于「可交给下游」——success 是**暂定**的，可能被总管打回变 superseded。但 DAG 仍把 success 当依赖满足。

## 3. 目标 / 非目标

### 目标
- 下游任务只在**上游被总管接受**（评审过且未返工）后才派发。
- 现实隐喻：经理没验收热搜之前，文档岗不准动手；验收通过（或返工后再验收通过）才放行。
- 下游永远只基于**被接受的数据**跑一次，消除"下游先于其依赖交付/基于被否决数据交付"。

### 非目标
- **不**支持"接受后总管又改主意返工上游 → 自动级联重跑已放行的下游"（边缘的边缘，沿用 [QA-rework spec §7] 原边界：留给总管手动 redispatch 下游）。
- **不**改根任务首发（由 `start_immediate_tasks` 在 plan 确认时派，不经此闸）。
- **不**改失败级联跳过（`_any_prereq_failed` → skipped 不变；本特性只 gate success 路径）。
- **不**要求总管新增任何行为（接受是隐式的——见 §4）。
- 前端无需改动。

## 4. 设计（接受=隐式，沉默即接受）

**接受信号选型**：隐式接受——总管评审了某任务、且**没调** `redispatch_task`，即视为接受。落地为新列 `TaskExecutionLog.qa_accepted_at`（评审轮结束对账时盖），而非直接看 `reported_at`（后者在评审轮**开始**就盖、早于总管定论，会误判）。

### 4.1 派发门槛改写（dependency_scheduler）
后继可派条件从"前置 success"改为"前置 **已 QA 接受**"。
- 新谓词 `_all_prereqs_accepted(dep_ids, db)`：每个前置 task 存在一条 `run_status in ("completed","success") AND qa_accepted_at IS NOT NULL` 的 log。
- **数据源（避坑）**：**直接查 DB**，不要塞进现有 `_log_status_by_task` 的聚合 `set`——`set` 无法表达"哪条 log 被接受"（返工后同一 task 下并存 `superseded` 旧 log + `success` 新 log）。实现建议：一条查询取"已接受前置"集合
  `SELECT DISTINCT task_id FROM task_execution_logs WHERE task_id IN (dep_ids) AND run_status IN ('completed','success') AND qa_accepted_at IS NOT NULL`
  → `accepted_set`；`_all_prereqs_accepted = all(d in accepted_set for d in dep_ids)`。
  - 该查询天然排除 `superseded`（非 success）——被打回的旧 log 不会满足；只有被接受的 success log 满足。`_collect_prereq_artifacts`（取 latest success）与此一致：被接受的 success 即下游要消费的产物。
- 替换 `on_employee_task_completed` 派发分支中 `_all_prereqs_done` 的调用点（`dependency_scheduler.py:351`）。
- 根任务（无依赖）与失败级联跳过逻辑不受影响。

### 4.2 「终态不再急派下游」——**无独立改动，由 §4.1 谓词达成**
不改 `_finalize_task_stream` / `on_task_finalized`。员工任务终态时 `on_employee_task_completed` 照常被调（失败级联跳过仍需它），但其派发分支已改用 §4.1 的接受谓词：终态时上游尚未盖 `qa_accepted_at` → `_all_prereqs_accepted` 为假 → 下游自然不派。**实现者不应改动 `_finalize`**——"不急派"是谓词的副作用，不是独立拦截。

### 4.3 放行对账钩子（总管评审轮结束）— 钩子点已确认
**钩子点**：`stream_registry.py:2208-2216` 的流收尾 finally 块——任何流结束且 `orchestrator_conversation_id` 非空时调 `report_debouncer.on_stream_end(orchestrator_conversation_id)`（`:2214`）。总管评审流（source=`orchestrator_reentry`）以**自己的会话**作 `orchestrator_conversation_id`，故其收尾**必经此处**（已读码确认）。
**接线**：新放行对账函数签名 `release_accepted_downstream(orchestrator_conversation_id: int)`，在该 finally 内、紧接 `on_stream_end(orchestrator_conversation_id)` 调用点（`:2214` 一带）以同一 `orchestrator_conversation_id` 调用（该值此处现成可用）。

**辨别"总管自己的评审流" vs "员工任务流"**：评审流 `conversation_id == orchestrator_conversation_id`（它就是总管会话）；员工任务流二者不等。放行对账只在前者运行（或无条件运行亦安全——见下）。

**放行对账动作**：对该总管会话下满足
`run_status in ("completed","success") AND reported_at IS NOT NULL AND qa_accepted_at IS NULL`
的 log（"评审过、仍 success、尚未标记接受"）→ 盖 `qa_accepted_at = now` → 调 `on_employee_task_completed(task_id)` 放行其下游。
- **幂等**：`qa_accepted_at` 一次性，已盖的不再处理。
- **竞争安全**：`redispatch_task` 在评审轮**内同步**把被否决的旧 log 标 `superseded`，故评审轮结束时被打回的 log 已是 superseded、不在 success 集，不会误盖接受。
- **时序成立**：`trigger_incremental_report` 在起评审流成功后即盖 `reported_at`（早于流结束），故评审流收尾时被评审 log 的 `reported_at` 必已就位。
- **在员工流收尾时误跑也无害**：刚完成的员工 log 此刻 `reported_at` 尚为空（评审还没起），对账条件不满足 → 跳过。故即便不加 `conversation_id==orchestrator_conversation_id` 辨别也安全；加辨别仅为省去无谓扫描。

### 4.4 防呆兜底（启动对账）
启动对账（关联 B7 重启对账同一处）补盖：对历史 `success AND reported_at 非空 AND 未 superseded AND qa_accepted_at 为空` 的 log 盖 `qa_accepted_at` 并触发一次下游放行评估。
- **覆盖范围**：解决"评审错过/进程重启 → 已 success 却没盖接受 → 下游卡在等接受"。
- **不覆盖（明确）**：进程在返工流 queued 落库后、流真正起来前崩溃 → `_reset_orphaned_streams` 把该 queued 新 log 重置为 `failed`，此时 task 下无 success log，本对账（条件含 success）不会、也不应放行下游。该 case 走**既有失败级联跳过**路径（`_any_prereq_failed` → 下游 skipped），是"返工被重启打断"的既有降级（[QA-rework spec §7]），**不是死锁**；不要指望 §4.4 复活它。

### 4.5 边界与数据流
- **共享桌产物**：下游放行时 `_collect_prereq_artifacts` 取前置最新 success log = 被接受的那条；若上游返工过，最新 success 即返工后的好数据，下游自然取到。
- **接受后又返工**（总管改主意）：下游已放行、已基于当时好数据跑；本期不自动级联重跑下游（非目标）。
- **无下游的叶子任务**：照样会被盖 `qa_accepted_at`，但无后继依赖它，无副作用。

## 5. 数据 / 机制改动面（纯后端）
- `TaskExecutionLog` 新增 `qa_accepted_at DATETIME NULL`（模型 + `init_db.ensure_column` 迁移）。
- `dependency_scheduler`：新谓词 `_all_prereqs_accepted`，替换派发分支门槛（§4.1）。
- 放行对账函数（建议置于 `dependency_scheduler` 或 `reentry`/新模块）：扫描 + 盖 `qa_accepted_at` + 放行下游；在总管评审流 `on_stream_end` 处调用（§4.3）。
- 启动对账补盖 `qa_accepted_at`（§4.4）。
- `TaskExecutionLogRead` DTO **可选**暴露 `qa_accepted_at`（前端暂不需要；YAGNI，先不加，除非调试需要）。

## 6. 测试策略
- **谓词**：`_all_prereqs_accepted` — 前置 success 但 `qa_accepted_at` 为空 → 不可派；盖了 `qa_accepted_at` → 可派；前置 superseded → 不可派。
- **放行对账**：success+reported+未 superseded+未接受 → 盖 `qa_accepted_at` 且触发下游放行；superseded 的 → 不盖；已接受的 → 幂等不重复。
- **集成（情景 B 回归）**：模拟"上游 success → 评审打回返工 → 返工 success → 再评审接受"，断言下游仅在最终接受后派发一次、且简报取返工后产物。
- **启动对账**：历史 success 未接受 → 启动后被补盖 + 下游放行。
- **基线**：后端 5 failed/583 passed（+本特性新测试），零新增；前端不动。

## 7. 风险
- **新失败模式「下游卡在等接受」**：若总管评审永不发生，下游永不放行。缓解：QA 评审本就是已载重机制（增量引擎），且 §4.4 启动对账兜底。仍建议加日志：放行对账每轮记录"本轮盖接受 N 条/放行下游 M 条"。
- **评审轮 `on_stream_end` 钩子的触发可靠性**：已读码确认总管评审流经 `stream_registry.py:2208-2216` finally（其 `orchestrator_conversation_id`=自身会话）。残余风险：评审流被 REJECTED（总管占线，从未真正起流）时不经此 finally——但此情形下 `reported_at` 也未盖（`trigger_incremental_report` 仅在非 REJECTED 才盖），评审会被补触发重来，对账自然在后续成功轮兜住；§4.4 启动对账为最终兜底。
- **多轮评审批次**：放行对账不依赖"本轮评审了哪些"，而是全量扫描"reported 且未接受且未 superseded"——天然覆盖跨轮、漏评审补评审的情况，更稳。
- **capacity/slot 跳过非卡死**：放行对账调 `on_employee_task_completed` 派下游时，若下游员工 capacity 满或无 stream slot，现有派发分支 `continue` 跳过（不派不记）。该下游会在 capacity 释放时（下一个员工流结束 → `on_employee_task_completed` 重评估）再次被尝试派发——这是现有 scheduler 既有的重试链路，**不是本特性引入的卡死**。盖了 `qa_accepted_at` 是持久的，重评估时谓词仍满足。

## 8. 验收对照
冒烟情景 B 不再复现：文档岗只在热搜被总管接受后开跑，且取到的是（返工后的）被接受热搜数据；不再出现"文档先于其依赖的热搜交付"。
