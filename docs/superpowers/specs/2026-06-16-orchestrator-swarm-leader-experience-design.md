# 总管 = 结果导向的 swarm 主管 —— 体验重构设计

> 状态:设计已与用户评审通过(方向),待 spec 评审 + 通读。
> 分支:feat/orchestrator-centric。日期:2026-06-16。

## 1. 背景与原则

产品「总管中心化」:用户(领导)↔ 总管(curator/orchestrator)对话,总管按任务复杂度
**自调度**(自己干 / 派员工后台执行)。

**用户拍板的产品原则(本设计的总纲):**
> 领导给总管发布任务,总管自行安排(自己干或安排人干)。**领导和总管都不关心
> 每个员工"怎么干"(调什么工具、过程),只关心「结果」(必须如实汇报)+ 把控
> 大方向;不行就返工。** 像真实世界:领导安排活,不管你怎么干,只要结果,不行继续改。

**两个体验目标:**
1. **总管体验流畅** —— 总管像主 agent + swarm worker,不是"派完活就沉默到最后"。
2. **总管真能掌握整盘概况** —— 任何时刻总管都清楚哪些任务完成/在跑/失败及其结果;
   前提是子任务**如实把结果反馈上来**。

**直接推论(原则落到设计):**
- 只到「状态级」,**不展示**员工的工具/步骤/逐字过程(没人关心怎么干)。
- 面板只给:谁、任务名、状态、可展开的**结果**。
- 总管的「增量反应」= 对**结果**发话 + 把控方向 + 不行就返工。

## 2. 现状(关键事实,详见探查)

- 每个任务完成时,`append_orchestrator_execution_summary`(`orchestrator_execution_summary.py`)
  **已即时**往总管会话写一条 assistant 摘要消息(用户可见、SSE 刷新),内容直接取员工
  会话最后回复(不另起 LLM)。**但不唤醒总管 LLM**。
- 唤醒总管**只在整盘全部定局**触发一次:`dependency_scheduler.py:397` all_settled →
  `trigger_orchestrator_reentry`(`reentry.py`),塞一条 user 消息 `（系统）请整合团队成果`
  (reentry.py:120)作展示锚点,**真正喂 LLM 的是 `brief`**(全部任务结论)。`plan.status=="summarized"`
  幂等门闩,一次性。
- 总管**默认看不到执行快照**:`build_delegation_execution_context`(`prompts.py:189`,能把
  TaskExecutionLog 快照注入 system prompt)**已实现但零调用**(悬空)。总管要靠 `list_tasks`
  工具主动查。
- 前端:摘要消息经 `message-classifier` → `OrchestratorTaskSummaryCard`,且 `buildCuratorTimeline`
  把执行卡按时间插进总管时间线;`curator-view` 把这些 source 的消息从气泡流过滤掉、改以
  时间线卡呈现。
- 数据绑定:`TaskExecutionLog.orchestrator_conversation_id` → 总管会话;
  `useCuratorTaskExecutions(总管会话id)` 按此拉全部执行(含运行中),SSE `task_completed` 刷新。

## 3. 目标 / 非目标

**目标**
- B1 去掉机械的「(系统)请整合团队成果」。
- B2 总管**增量、去抖**地对陆续到达的结果做反应(异步前提不变)。
- B3 总管唤醒/接话时能看到**整盘任务快照**(接线 `build_delegation_execution_context`)。
- A1 撤掉总管时间线里的员工任务卡(含回退 e4ae98c3 内联活卡)。
- A2 常驻「员工任务」面板(chat header 图标展开,Claude-Code Background tasks 式)。
- A3 消息下「N 个任务在执行」指示,点击开面板。

**非目标**
- 不做进度级/直播级(工具/步骤/逐字)——原则上不关心过程。
- 不改"真异步"前提(不走"同轮 await"的 Claude-Code Task 模型)。
- 不做运行中打断/重指派的新交互(总管返工沿用现有再派活能力,不新增 UI)。

## 4. 子项 B —— 编排回流(后端,核心)

### B1. 去掉「(系统)请整合团队成果」
`reentry.py`:不再 `_append_message(role="user", content="（系统）请整合团队成果")`。
保留 assistant 占位 + `brief` 作为实际 LLM 输入。总管以 assistant 自发开口,体感自然。
**风险:无**(brief 路径不变)。

### B2. 去抖增量唤醒(核心机制)

**触发源(per-task)**:任务终态收尾后(`_finalize_task_stream` 写完 summary →
`on_task_finalized` 回调,或 `dependency_scheduler.on_employee_task_completed`),把该任务
标记为「待汇报」,并通知对应 `orchestrator_conversation_id` 的**去抖器**。

**去抖器(per 总管会话,跑在主事件循环)**:
- 收到完成通知 → (重)启一个短计时器(默认 `REPORT_DEBOUNCE_MS ≈ 1500`)。
- 计时器到点(窗口内无新完成):
  1. 收集该会话所有「待汇报且未汇报」的任务。
  2. 若总管会话**流槽空闲**(`request_start` 可成功)→ 起一轮总管 turn,brief =
     「**自上次以来的新结果**」+「**整盘任务快照**」(见 B3);把这些任务标记为已汇报。
  3. 若总管**正忙**(在流式)→ 不触发;待汇报缓冲保留,等总管这一轮流结束补触发(合并)。
- **末尾整合**不再特殊:最后一个任务完成的那次去抖唤醒即自然收尾。

**"总管流结束补触发"需新增钩子(实现者务必按此,不要复用员工专用回调)**:当前没有现成
可挂的"总管流结束"钩子 —— `_finalize_task_stream` 里的 `registry.on_task_finalized` 只在该
会话存在 TaskExecutionLog(running/queued)行时触发(stream_registry.py 约 L2323 `if not log:
return`),是**员工任务专用**,总管自身的 reentry/user_chat 流不会触发它。需在
`_run_agent_background` 的 finally 块(总管流真正收尾处)判断该流 conversation 是某
`orchestrator_conversation_id`,经 `call_soon_threadsafe` 通知去抖器"该会话流已空闲→检查
待汇报缓冲,有未汇报终态任务则补触发一轮"。

**幂等(per-task,持久)**:
- `TaskExecutionLog` 新增 `reported_at`(timestamp,可空)。唤醒 brief 只含 `reported_at IS NULL`
  的终态任务,纳入本轮后即写 `reported_at`。重启不丢。
- **迁移必做**:`reported_at` 是新列,须在 `init_db.py` 的 `ensure_column` 序列补一行
  (`ensure_column("task_execution_logs", "reported_at", "reported_at TIMESTAMP")`,与现有同表
  加列同模式)。**遗漏会导致升级后写 `reported_at` 报 OperationalError、B2 上线即崩。**

**与原 all_settled 一次性触发的协调(明确,无歧义)**:
- **移除** `dependency_scheduler` 中 all_settled → `trigger_orchestrator_reentry` 的一次性调用,
  改为 per-task 完成时通知去抖器。
- **唤醒幂等只靠 per-task `reported_at`**;**移除** `trigger_orchestrator_reentry` 里
  `plan.status=="summarized"` 的早返回门闩(plan 级一次性门闩,与增量模型冲突)。`plan.status`
  字段保留:可在"整盘全部任务 `reported_at` 非空"时置终态值供外部只读展示,但**它不再 gate
  任何唤醒**。
- **不双重整合**:每轮唤醒只纳入 `reported_at IS NULL` 的任务、纳入即标记;全部标记后再无可
  纳入任务 → 不再唤醒。
- **不丢最终整合**:最后一个完成事件触发的去抖唤醒即最终整合;若那次因总管占线未消费,靠
  上面"总管流结束钩子"补触发;若进程中途重启,见 §7"重启对账"。

**成本**:去抖天然合并近乎同时的完成;10 个任务陆续完成→只起少数几次唤醒而非 10 次。
可选上限 `MIN_WAKE_INTERVAL` 防极端高频。

**总管该说什么(prompt 侧)**:再入这一轮的 system/brief 提示总管:你是 swarm 主管,
**对新到的结果发话**(简短向用户同步进展/把控),如结果不达标可直接返工(再派活);
不要逐条复述、不要轮询 `list_tasks`(快照已给)。

### B3. 总管掌握整盘概况
接线现成的 `build_delegation_execution_context`(`prompts.py`):在总管 agent 构建时
(`get_orchestrator_agent`)或再入 brief 里,注入**当前会话所有任务的执行快照**
(任务名、负责员工、run_status、结果摘要截断)。让总管无论被唤醒还是用户主动接话,都
"看得到整盘"。注意快照体量:按 `orchestrator_conversation_id` 限定 + 每条结果截断(如 800 字),
避免压垮上下文。

## 5. 子项 A —— 前端呈现

### A1. 撤时间线任务卡
- 回退 e4ae98c3:`build-curator-timeline` 不再把执行(无论终态/运行中)插入时间线;
  相关 `ExecutionReportCard` 进行中态改造若仅服务时间线则一并回退(面板若复用则迁移)。
- `curator-view` 时间线 = 纯总管↔用户对话(含总管对结果的增量发话)。
- `orchestrator_execution_summary` 消息**保留为数据**(供面板/总管 brief),但不再渲成
  时间线卡(继续从气泡流过滤)。

### A2. 常驻「员工任务」面板
- chat header(curator 头部/compact 工具栏)加一个图标按钮,开关右侧「员工任务」面板。
- 面板内容:本总管会话的员工任务列表(`useCuratorTaskExecutions`,SSE 实时):状态徽章
  (进行中/排队/完成/失败)、员工名、任务名、可展开看**结果**;点某条可跳员工只读转录
  (沿用现有 `navigateToEmployeeFromCurator`)。
- 复用:UI 可借 `SubtaskPanel` 的"进行中/已完成分区 + 可展开"外形,但**数据源换成
  TaskExecutionLog**(新 store slice 或直接 hook 驱动),不与 deepagents 内部 task 工具混用。
- 与现有右面板(产物/监控/浏览器/子任务)的互斥/槽位关系需纳入 chat-layout `rightPanel`。

### A3. 「N 个任务在执行」指示
- 一个紧凑指示(派活那条消息下方,或 composer 上方常驻):显示运行中数量(来自
  `useCuratorTaskExecutions` 过滤 running/queued);点击 → 打开 A2 面板。

## 6. 测试

- **B 单测**:去抖合并(多完成→一次唤醒)、总管占线时缓冲+流结束补触发、`reported_at`
  幂等(同任务不重复汇报)、brief 只含新结果、快照注入内容正确。
- **B 回归**:现有 `test_orchestrator_execution_summary`(已知基线失败,需确认本改是否顺带
  修复或仍隔离)、reentry 相关测试。
- **后端全量**:`uv run pytest -q`,已知 5 基线不得新增。
- **A 前端**:`build-curator-timeline.test`(撤卡后断言不再插执行卡)、面板渲染/指示计数;
  深 typecheck `tsc -p tsconfig.app.json`(基线 90)、`vitest`(基线 1 失败)零新增。

## 7. 风险

- **并发**:完成事件在 `_DB_WRITE_EXECUTOR` 单写线程,去抖/唤醒在主事件循环 —— 跨线程用
  `call_soon_threadsafe`(沿用 reentry 现有做法);去抖器状态需线程安全。
- **总管占线导致汇报积压**:靠"总管流结束钩子补触发"+ `reported_at IS NULL` 保证不丢。
- **重启对账(去抖器是内存态)**:去抖 timer + 待汇报缓冲是纯内存,进程重启会丢。持久性靠
  DB:启动时(或下一个完成事件/总管流结束钩子触发时)扫描"终态且 `reported_at IS NULL`"的
  任务,重建待汇报集并按去抖逻辑补一次唤醒。须在 startup 钩子里加这条对账扫描。
- **唤醒频率/成本**:去抖 + 可选最小间隔;大计划仍线性但已大幅收敛。
- **快照体量**:限定会话 + 截断,防上下文膨胀。
- **前端面板与既有右面板槽位冲突**:纳入 rightPanel 互斥统一管理。

## 8. 推进顺序

1. **B1**(零风险)先落:去「请整合」。
2. **B3** 接线执行快照(中风险,独立)。
3. **B2** 去抖增量唤醒(核心,最需评审 + 测试)。
4. **A1→A2→A3** 前端(A1 撤卡可与 B 并行;A2/A3 面板+指示)。

每步过验证基线(后端 pytest 5 基线、前端 typecheck 90 / vitest 1 基线,均零新增)。
