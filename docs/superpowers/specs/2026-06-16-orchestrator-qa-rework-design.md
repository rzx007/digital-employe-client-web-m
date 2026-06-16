# 总管一线质检 + 自主透明返工 — 设计 spec

- 日期：2026-06-16
- 分支：feat/orchestrator-centric
- 关联：[2026-06-16-orchestrator-swarm-leader-experience-design.md](2026-06-16-orchestrator-swarm-leader-experience-design.md)（增量汇报引擎 + 汇报骨架）

## 1. 背景与问题

总管中心化重构后，员工子任务完成 → 增量汇报引擎唤醒总管汇报（已上线汇报骨架：计数 + ✅/⏳ 状态清单）。
但总管现在只做「**汇总 + 往上递**」，把**全部**结果验收/返工压到了人类领导（用户）身上。

用「领导 → 总管 → 员工」的组织比喻看：现实里质检是**两层**的——
- **总管（经理）= 一线质检**：团队交活，经理先把一道关，明显不达标的当场打回重做，只把过得去的往上递；
- **领导（你）= 最终验收**：战略层面"满不满足我要的"，拍最终板。

**当前实现缺的正是第一层**。总管 prompt 里只有一句软指令「结果不达标可直接返工（用 create_orchestration_plan 重派）」——没有强制验收动作、没有验收标准对照、没有规范的返工状态与防失控。

## 2. 目标 / 非目标

### 目标
- 让总管**真正担起一线质检**：对每个员工交付，对照派活契约显式判定达标/不达标。
- 不达标时总管**自主返工但透明**：当场打回重做，同时如实告知领导（判定理由 + 第几次返工）。
- 防失控：返工次数硬上限，超限升级给领导定夺。
- 人类领导的**最终验收不变**，但现在只看到总管已质检过的活 + 总管的质检结论。

### 非目标（本期不做）
- **不**新增独立 reviewer agent（见 §8 演进路线：日后= 招质检员 + 派活，近乎零架构改动）。
- **不**新增显式 `acceptance_criteria` 字段（复用派活契约的「输出」项当标准，单一真理源）。
- **不**支持"员工会话内追加返工指令"（架构暂不支持，排除）。
- **不**改动人类领导的 `confirm_execution_result` HITL 最终验收链路。

## 3. 角色与两层验收

```
领导（人类）  ── 最终验收（confirm_execution_result HITL，不变）
   ↑ 只上递总管质检过的活 + 质检结论
总管（经理）  ── 一线质检：对照契约判定 → 达标上递 / 不达标自主返工
   ↑ 交付
员工          ── 执行子任务，产出交付物
```

## 4. 设计

### 4.1 验收标准来源：复用派活契约的「输出」
每条子任务的 `EmployeeTask.user_prompt` 已含派活契约四要素（目标/输出/可用资源/非目标），其中**「输出」本身就是达标基线**。

- **改动**：评审时把**原任务契约**注入总管上下文。现状的评审 brief（`trigger_incremental_report` 组的"新结果摘要 + 整盘快照"）**缺原始契约**，总管无从对照——补上即可。
- 单一真理源：「输出」既定义"做什么"也定义"什么算过"，不另立标准、不怕两份标准漂移。

### 4.2 判定 + 自主透明返工流

任务终态 → 现有增量汇报 turn 唤醒总管。总管在**已有汇报骨架**里对每个完成项给判定：

- `✅ 达标` → 正常汇报，进入领导的最终验收。
- `↻ 不达标` → 调**新工具 `redispatch_task(task_id, rework_note)`**，并在正文透明告知：
  「我判定 X 不达标（理由：…），已打回重做（第 N 次）」。

**`redispatch_task` 机制（在**同一员工对话**里续聊返工，**不**新建会话）**：
1. 校验 `rework_count < MAX_REWORK`（默认 2），否则**硬拒**并要求升级（见 §4.3）。
2. 取该 `task_id` 上**当前那条已终态 log**（即触发本轮总管评审、已被 `reported_at` 盖戳的那条；按 `id desc` 取最新），记下它的 `conversation_id`（=要续聊的员工对话），并把该 log 标记为 `superseded`（打回，仅供展示，不再计入"待汇报"）。
   - 注：`trigger_incremental_report` 按"所有 `reported_at IS NULL` 的终态 log"选取（非 latest-per-task），`collect_plan_execution_results` 才是 latest-per-task。`redispatch_task` 运行时该 log 必已被 `reported_at` 盖戳（总管只能经评审 turn 看到它），故转 `superseded` 不会误改未汇报行、也不会被重新选取。
3. **在该 `conversation_id` 的现有员工对话里追加一轮返工 turn**（不新建 Conversation）：
   - 向该会话 `_append_message` 一条 user 消息 = `rework_note`（不达标的点 + 改进要求）；再加 assistant 流式占位。
   - 建**新** `TaskExecutionLog`（同 `task_id`、**复用同一 `conversation_id`**）记录本轮返工执行。
   - 重建该会话的员工 agent 并起流（LangGraph `thread_id = conversation_id`，**天然带上轮 checkpoint 记忆**——员工看得到自己的初稿推理 + 产出 + 本次返工要求，在原稿上改）。
   - 共享桌按 `task.id` 不变，员工续聊时上轮产物仍在桌上可 `ls/read`。
4. `EmployeeTask.rework_count += 1`。

这是**新写的一条派发路径**（不能直接复用 `start_task_as_conversation`，它硬编码新建会话）——可抽取 `start_task_as_conversation` 中"建 log + 建 agent + 起员工流（含等总管 idle、占位、task_started 事件）"的公共部分，差异仅在"建新会话 vs 追加到现有会话"。

**log ↔ 对话由 1:1 变 1:N**（一个员工对话下挂初稿 + 各次返工的多条 log）：snapshot/卡片按 latest-per-task 取最新一条，「查看员工对话」链接指向该 `conversation_id` → 点进去是一条完整的"初稿 → 打回 → 返工"线索。需核对无代码依赖 log↔conversation 严格 1:1。

**返工"循环"天然复用现有增量引擎**：返工执行完成 → 触发新一轮增量汇报 → 总管再审，`reported_at` 幂等管每一轮。不新造循环，就是 `审 → 续聊重做 → 完成 → 再审`。

### 4.3 防失控：硬上限 + 升级
- `MAX_REWORK`（默认 2）**硬卡在 `redispatch_task` 工具内**，不靠 prompt 自觉。
- 超限：工具直接返回拒绝（含原因），总管转告领导：
  「X 返工 2 次仍不达标，请定夺（换人 / 改需求 / 接受现状）」。

### 4.4 边界
- **仅委派任务走总管质检**。总管"亲自干"的活不走 `start_task_as_conversation`、没有 `TaskExecutionLog`，质检循环**天然只对委派任务生效**——不会去返工总管自己的活（避免自说自话）。此边界基本自动成立，无需额外代码。
- **失败（error）任务**并入同一流（本就该返工或如实说明）。

### 4.5 可见性
- **后端**：执行卡片/面板状态新增「打回（superseded）」与「返工中（第 N 次）」表达（由 `rework_count` + log 状态驱动）。
- **正文**：汇报骨架里 `↻` 标记 + 理由 + 次数（prompt 约定，无需新结构）。

## 5. 数据 / 机制改动面

### 后端
- `EmployeeTask` 新增 `rework_count INTEGER DEFAULT 0`（迁移 + startup ensure_column）。
- `TaskExecutionLog.run_status` 新增/复用 `superseded`（打回）取值；不计入"待汇报终态集"`_SETTLED_STATES` 的汇报选取（避免打回的旧 log 重新入选）。
- 新派发路径"在现有员工对话续聊返工"：抽取 `start_task_as_conversation` 的公共部分（建 log / 建 agent / 起员工流：等总管 idle、占位消息、`task_started` 事件），新增分支"追加到现有 `conversation_id`"而非新建 Conversation。
- 新工具 `redispatch_task(task_id, rework_note)`（orchestrator/tools/tasks.py）：上限校验 + 取最新 log 的 `conversation_id` + 标记旧 log `superseded` + 走续聊派发路径 + `rework_count += 1`。
- 评审上下文注入原契约：`trigger_incremental_report` / `build_delegation_execution_context` 为每个新结果带上 `EmployeeTask.user_prompt` 的「输出」契约。
- 增量汇报 brief 文案：从"请整合"升级为"请**对照各任务的输出契约逐项质检**，达标则汇报、不达标调 `redispatch_task` 打回"。

### 前端
- `TaskExecution` 类型加 `rework_count`；卡片/面板渲染「打回 / 返工中（第 N 次）」状态。

### prompt
- 总管系统提示词新增/改写「一线质检」段：两层验收角色、对照「输出」契约判定、不达标调 `redispatch_task` 自主透明返工、上限升级；接到已有「进度汇报骨架」上（替换原"结果不达标可直接返工（用 create_orchestration_plan 重派）"软指令）。
  - **保留**现有反轮询 / "看到任务仍 running 时结束本轮"指引：质检新增了一个总管可能想重查 `list_tasks` 的理由，须确保替换后这条防轮询护栏不被一并删掉。

## 6. 测试策略
- **后端**：`redispatch_task` 上限硬拒（达 MAX 返工拒绝并提示升级）；返工产生同 `task_id` 新 log 且旧 log 转 `superseded`；`superseded` 不被增量汇报重新选取；`rework_count` 递增。
- **prompt 不变量门**：新增锚点断言（`redispatch_task` 工具名、"质检/验收"关键词在总管提示词中）。
- **前端**：卡片「返工中（第 N 次）」状态渲染。
- **基线**：后端 5 failed / 前端 typecheck 90 / vitest 1 failed —— 改动后零新增。

## 7. 风险
- **总管放水**（把不达标判成达标）：本期不解决，恰是要用真实运行**攒数据**的对象——数据证明放水严重，才上 §8 独立 reviewer。
- **返工与依赖 DAG 交互**：被打回任务的下游若已 skip/在跑，重派后下游是否重算——实现期需明确（初版：返工只重跑本任务，下游消费新结果由总管在再审轮决定是否一并重派）。
  - 已知缓解：`dependency_scheduler` 的前置产物消费按"latest `_PREREQ_DONE_STATES` log by id desc"取——返工产生更新的 success log，下游**若被再派**会自然取到返工后的新产物，无需特殊处理。

## 8. 演进路线：独立 reviewer = 未来的"质检员岗位"
在员工架构里，"独立 reviewer"**不需要新造 agent 子系统**——它就是**再派一个员工**：招一个**质检员**、给它"审核"技能，总管要独立评审时像派任何活一样派给它（「审核 X 的交付是否达标，标准：…」），走的还是现有派活/执行/汇报全套机制，**零架构改动**。

本期做的质检地基（契约当标准注入、`redispatch_task`、`rework_count`、`superseded` 状态）**无论将来要不要独立 reviewer 都照用**。故先做总管质检：① 立刻产生价值；② 顺手攒出"要不要独立 reviewer"的判断数据；③ 让独立 reviewer 日后近乎零成本可加。
