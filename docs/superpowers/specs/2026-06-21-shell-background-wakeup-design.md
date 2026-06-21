# 子项目 C：超长后台命令跑完自动唤醒模型续跑 设计

日期：2026-06-21
状态：设计待评审

## 背景与问题

「三类完整设计」的第三个、也是最后一个子项目。A（[[shell-rhythmic-wait-cursor-style]]）让模型有节奏 shell_wait 等慢命令；B（start_service）让模型起常驻服务。但还有一类：**真·超长任务**（拉大镜像 1h、全盘扫描、大型编译），模型 shell_wait 等几轮判定「这要很久」后，A 的诚实兜底是告诉用户「稍后问我进度」——**用户得自己回来问**。C 要补上最后一块：命令**真跑完后，后端主动把模型拉回原会话续跑一轮**，把「稍后问我」升级成「完成后我会自动告诉你」。

这是整个系统最敏感的操作：后端主动重新驱动一个已结束的会话。调研（见下「现状」）确认 resume 热循环、僵尸流、重复 turn 都从这里来，所以 C 的设计核心是**复用已验证的成熟唤醒路径 + 三道防竞态闸**，而非发明新机制。

## 现状（调研结论，决定可行路径）

- **所有唤醒最终收口到 `stream_registry.request_start(...)`**（`registry.start` 是其薄包装）。它**非线程安全**，必须先在主 asyncio 循环线程内、经 `get_main_loop().call_soon_threadsafe(...)` 搬过去再调。
- **成熟唤醒模板**：`task_scheduler_service._start_curator_task`（`:578`）/ `execution.start_task_as_conversation`（`:298`）已把「外部事件 → 模型续跑一轮」做全：确保 Conversation → 落 user 消息 + 新建 assistant 空壳消息 → 在主线程构造 agent → `call_soon_threadsafe` → `registry.start`。LangGraph checkpointer（`thread_id=conv_id`）自动带历史上下文。
- **shell 注册表当前没有任何「进程结束 → 信号」出口**：纯被动轮询，`_Session` 无回调字段、无 watcher 线程、`sweep()`（`:181`，有 `_MAX_AGE_SECONDS=3600` 超龄强杀逻辑）**从没被任何地方调用**。C 要补的正是这根「跑完 → 主动续跑」的线。
- **apscheduler 已在用**：`_register_system_jobs` 注册系统周期 job（如 `dispatch_order_sync` 每 5 分钟）。C 复用它加一个扫描 job 即可，不引入新长驻线程。

## 设计决策（已与用户确认）

- 驱动方式：**复用 apscheduler 周期扫描注册表**（最稳最小）——不给注册表加 watcher 线程/进程回调，不碰 SSE/request_start 内核。
- 谁被唤醒：**模型显式登记** —— shell_wait 几轮判定超大任务、要升级时，调新工具 `watch_background(session_id)` 登记「这个 session 跑完唤醒我」。只有被登记的才被扫。
- 续跑会话/内容：**原会话续跑** + 注入 `[后台任务完成] session_id=X exit_code=Y\n末尾N行输出` 作新 user 消息。
- 防重复/竞态：**watch 条目单次性状态机（watching→fired→移除）+ 会话忙则本轮跳过、下轮再扫**。
- 卡死兜底：**不做主动超时杀**（用户：卡死子进程不影响主服务、有 shell_kill 能手动干掉，YAGNI）。watch 只保留一个硬上限（24h）清理死条目防内存泄漏，不杀进程、不唤醒。

## 范围

后端，5 块。

### 块 1：watch 登记表

文件：新建 `apps/server/src/service/background_watch_registry.py`（全局单例，仿 `shell_background_registry` 的单例 + 锁结构）

- `_Watch` dataclass：`session_id, conversation_id, is_orchestrator, workspace_id, employee_id, command, created_at, status="watching"`（watching | fired）。
- `register_watch(*, session_id, conversation_id, is_orchestrator, workspace_id, employee_id, command) -> None`（同 session 重复登记则覆盖刷新）。
- `list_watching() -> list[_Watch]`（只返 status==watching 的快照）。
- `mark_fired(session_id)`：置 fired 并从表移除（fired 即删——单次性）。
- `drop(session_id)`：直接移除（进程 not-found / 续跑异常时用）。
- `sweep_stale(max_age_seconds=86400)`：移除 created_at 超 24h 的条目（防废条目堆积，不杀进程）。
- 模块级 `get_background_watch_registry()` 单例访问器。

### 块 2：watch_background 工具

文件：`apps/server/src/service/agent/shell_execute_tool.py`（加工厂 `create_watch_background_tool`）

- 入参：`session_id: str`。
- 先 `shell_background_registry.poll(session_id)` 校验：not found / 已 finished → 不登记，返回「该命令已结束（或已回收），无需 watch；用 shell_poll 看结果即可」。
- 仍在跑 → 从运行上下文取 `conversation_id`/`workspace_id`/`employee_id`/`is_orchestrator`，调 `register_watch(...)`，返回「已登记：该命令完成后我会自动回到本会话继续，无需你盯着」。
- **运行上下文来源**：复用现有 ContextVar / runtime 取当前会话信息的机制（实现时定位 `runtime.py` 或 agent 注入的 context；与 remember_memory 等工具取 conversation 同源）。若取不到 conversation_id → 返回「无法登记（缺会话上下文）」不崩。

### 块 3：唤醒扫描器

文件：新建 `apps/server/src/service/background_wakeup_scanner.py`

- `scan_and_wake(*, registry=None, watch_registry=None, wake_fn=None) -> dict`（依赖可注入，便于测试）：
  - 遍历 `watch_registry.list_watching()`：
    - `r = registry.poll(session_id)`
    - not found → `watch_registry.drop(session_id)`（无可唤醒）
    - running → 跳过
    - finished → 查该会话是否忙（`stream_registry` 有该 conv 活跃/排队流）：
      - 忙 → 跳过（保留 watching，下轮再试）
      - 空闲 → `wake_fn(watch, poll_result)` 续跑 + `mark_fired(session_id)`
  - `wake_fn` 抛异常 → 记日志 + `drop(session_id)`（不无限重试、不影响其它 watch）。
  - 末尾顺带 `watch_registry.sweep_stale()`。
  - 返回 `{scanned, woke, skipped_busy, dropped}` 便于日志/测试断言。

### 块 4：续跑触发器（默认 wake_fn）

文件：`background_wakeup_scanner.py`（同文件，`_default_wake_fn`）

- 复刻成熟模板（参照 `_start_curator_task`）：
  - 确保 `Conversation` 存在。
  - 新建一条 assistant 空壳消息（stream_state="streaming"/"queued"）。
  - 组装唤醒 user 消息：`[后台任务完成] session_id={sid} exit_code={rc}\n末尾输出:\n{tail}`（tail 取 poll 的 new_output 末尾 N 行；无输出→「(输出已被回收)」）。
  - **在主循环线程**构造 agent（总管 `get_orchestrator_agent` / 员工 `get_agent`，按 `is_orchestrator`）。
  - `get_main_loop().call_soon_threadsafe(...)` → `registry.start(conversation_id, agent, messages=[唤醒user消息], stream_msg_id=新assistant_id, source="background_wakeup", ...)`。
- 落库的新 assistant 消息状态与 registry 实际状态严格一致（避 resume 热循环，[[resume-hot-loop-db-registry-mismatch]]）。

### 块 5：接 apscheduler 周期 job + A 话术升级

文件：`apps/server/src/service/task_scheduler_service.py`（`_register_system_jobs`）+ `apps/server/src/service/agent/shell_execute_tool.py` + 两套 prompt

- 在 `_register_system_jobs` 加一个周期 job（如每 20s）调 `scan_and_wake()`，对齐现有系统 job 注册方式。
- **A 话术升级**：现在模型有了 watch_background，A 的「稍后问我进度」可升级。改 `shell_wait` 工具的「仍在运行」返回、转后台 at-handoff 话术（`skill_shell_backend.py`）、两套 prompt 的「超大才升级」段：超大任务 → **调 watch_background 登记 → 告诉用户「这任务较久，完成后我会自动回到这里继续，你不用盯着」** → 体面收尾。即「稍后问我」→「watch 登记 + 完成自动继续」。

### 不在本子项目范围

- 卡死/超长主动超时杀（用户砍掉，YAGNI）。
- watch 跨进程重启持久化（YAGNI——超长任务在同一进程生命周期内；持久化是另一个大坑）。
- 唤醒优先级 / 批量合并。
- 群编排 dependency_scheduler（不动；C 只管单个后台命令唤醒它所在会话）。

## 数据流

```
模型 shell_wait 几轮 → 判定超大任务 → watch_background(session_id)
  → 取 conv/ws/emp/is_orch → register_watch(status=watching)
  → 返回「完成后自动回本会话继续」→ 模型告诉用户 + 体面收尾

[apscheduler ~20s] scan_and_wake():
  for w in list_watching():
    poll(w.session_id):
      not found → drop
      running   → 跳过
      finished  → 会话忙? 忙→跳过(下轮) / 空闲→wake_fn续跑 + mark_fired
  sweep_stale()  # 24h 死条目清理
```

## 三道防竞态闸（最敏感）

1. **单次性**：watch watching→fired 即移除，同 session 永不唤醒两次。
2. **会话忙跳过**：续跑前查 registry 该会话有无活跃/排队流，忙则本轮跳过、保留 watching、下轮再试——绝不在会话忙时硬调 request_start（避 REJECTED 热循环）。
3. **主线程构造 + 搬运**：agent 必须在主循环线程构造（ContextVar 绑 db/workspace），`call_soon_threadsafe` 搬过去再 `registry.start`——绝不在 apscheduler 线程直接调 request_start。续跑落库新 assistant 状态与 registry 严格一致。

## 错误处理

- watch 时 session 不存在/已结束 → 工具不登记，提示用 shell_poll 看结果。
- 取不到 conversation 上下文 → 不登记，返回提示，不崩。
- 扫描时 finished 但取不到输出 → 唤醒消息带 exit_code +「(输出已被回收)」，仍唤醒。
- wake_fn 续跑抛异常 → 记日志 + drop 该 watch，不影响其它。
- 进程超长/卡死一直不结束 → watch 一直 watching（不主动杀）；用户可 shell_kill，kill 后 poll not-found → 下轮 drop。废条目超 24h 由 sweep_stale 清。

## 测试

后端 pytest（`cd apps/server && uv run pytest`）：
- watch 表：register/list/mark_fired/drop/sweep_stale；单次性（mark_fired 后不再 list 到）；同 session 重复 register 覆盖；24h 清理。
- watch_background 工具：仍在跑→登记成功+话术含「自动」；session 不存在/已结束→不登记+提示；缺会话上下文→提示不崩（mock 上下文取值）。
- 扫描器 `scan_and_wake`（注入假 registry/假 watch_registry/spy wake_fn）：finished+空闲→调 wake_fn + mark_fired；finished+忙→不调+保留 watching；running→不调；not-found→drop；wake_fn 抛异常→drop 不崩；末尾调 sweep_stale；返回计数正确。
- 续跑触发器（mock registry.start + 主循环）：断言新建 assistant 消息 + registry.start 被调且 messages 含 `session_id`/`exit_code`/末尾输出；source="background_wakeup"。
- A 话术升级：shell_wait「仍在运行」返回 / 两套 prompt「超大才升级」段含 watch_background + 「完成后自动」类词（替换原「稍后问我进度」）。
- import 冒烟：两个新模块 + 改动的 task_scheduler/prompts。
- 测试坑沿用：Win taskkill；扫描器测试 mock 掉真 registry.start/主循环/agent 构造，不真起 agent。

## 风险

- apscheduler job 在后台线程跑，扫描器**只读 + 构造续跑闭包**，真正 start 经 `call_soon_threadsafe` 回主循环——线程边界是最大风险点，靠「三道闸」+ 复用成熟模板控制。
- 续跑落库状态与 registry 不一致会触发前端 resume 热循环（[[resume-hot-loop-db-registry-mismatch]]）——续跑必须严格复刻模板的落库/状态时序。
- 扫描周期（~20s）= 唤醒最大延迟；对 1h 任务无所谓。周期太短增加无谓 poll，太长延迟大，20s 折中。
- watch 不持久化：进程重启丢失 watch（超长任务也随之断）——可接受（YAGNI）；重启本就中断后台进程。
- 模型可能不调 watch_background → 退化成 A 的「稍后问我」行为，不更差。靠 prompt 引导，不加硬闸（沿用 A/B 策略）。
- C 完成后，A 的诚实兜底约束解除：MEMORY [[shell-rhythmic-wait-cursor-style]] 里「不承诺自动通知」的待办在本子项目落地后失效，话术正式升级为「完成自动继续」。
