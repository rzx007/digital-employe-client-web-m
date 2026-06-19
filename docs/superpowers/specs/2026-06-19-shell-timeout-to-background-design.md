# shell_execute 超时转后台 + agent 轮询 设计

日期：2026-06-19
状态：设计待评审

## 背景与问题

agent 执行耗时命令（递归扫盘等）目前是「同步等到底」。上一轮把 LLM httpx `read_timeout` 改成 `None`（`factory.py:136`）让长命令不被 90s 误杀——但用户指出这是**坏方向**：变成了「程序无限挂等」，和 Cursor/Claude Code/hermes 的做法完全不同。后者是**主动管理**：命令有合理超时、长命令转后台/异步跑、agent 自己稍后回来 poll 状态，而不是把一个调用挂在那儿干等占着 LLM 连接。

本期目标：实现 hermes/Claude Code 式的「超时转后台 + agent 轮询」执行模型，并把 `read=None` 这个临时坏改动恢复成有限值。

## 现状（已调查坐实，file:line）

- shell 工具 `apps/server/src/service/agent/shell_execute_tool.py`：`create_shell_execute_tool`（~55），`ShellExecuteInput`（~37-52，只有 command/intent，**无 timeout**），`_arun`（~66-73）调 `shell.aexecute(command, tool_call_id=...)` **不传 timeout** → 用 `_default_timeout`（= `settings.execute_timeout*2` = 默认 1200s）。`aexecute`/`execute` 已支持 `timeout: int|None` 入参，只是工具层没透传。
- 后端 `apps/server/src/service/skill_shell_backend.py`：`aexecute`（~335-616）线程侧 `_read_lines_sync`（~407-482）`Popen(shell=True, stdout→临时文件)`、句柄塞 `_proc_ref`（list）、死循环 poll+每 0.1s 从临时文件读增量喂 async 队列；async 侧（~542-616）`asyncio.wait_for(queue.get(), timeout=effective_timeout)`——**timeout 是「两 chunk 间」等待上限，不是命令总时长**。超时分支（~565-585）`cancel_requested.set()` + `_proc_ref[0].kill()`，返回 `exit_code=124`+部分输出。线程侧 finally（~470-481）：`cancel_requested` 触发 kill；无条件 `os.unlink(_tmp_path)`。临时文件 `_MAX_TMPFILE_BYTES=1MB`（~361，超了 break）。
- 无现成进程注册表（`StreamRegistry` 管 agent 流，粒度是「整条会话流」，不适合管单条 shell 子进程）。
- 工具注册：员工 `employee.py:226` 的 `extra_tools` append、总管 `orchestrator/agent.py:281` 的 `orchestrator_tools` append，最后进 `create_deep_agent(tools=...)`。新工具不碰 DB、不需 `_serialize_db_tool` 包装。`checkpointer.py:41 excluded_tools={"execute"}` 只排内置 execute，不影响自定义工具。
- `factory.py:136`：当前 `read_timeout = None`（上一轮改的，本期块5恢复）。

## 设计决策（已与用户确认）

- 形态：**`shell_execute` 加 `timeout` 参数**；命令在 timeout 内完成 → 同步返回（现状）；超时未完成 → **不 kill、转后台**，返回 `session_id`+已有输出，模型用新工具 `shell_poll`/`shell_kill` 后续查/杀。
- 注册表：**进程级全局单例** `BackgroundShellRegistry`，总管/员工/所有会话共用，session_id 全局唯一（随机 uuid，跨会话猜不到、实际隔离够用）。
- 范围：**全做**（注册表 + aexecute 改造 + 3 工具 + 注册 + read 恢复），一步到位。

## 范围

### 块 1：后台进程注册表（新文件）

文件（新建）：`apps/server/src/service/shell_background_registry.py`

- 模块级全局单例。条目：`session_id(uuid) → {popen, tmp_path, read_offset, command, started_at, status}`，status ∈ {running, finished, killed}。
- 方法：
  - `register(popen, tmp_path, read_offset, command) -> session_id`：登记一个移交来的后台进程，返回随机 uuid。
  - `poll(session_id, from_offset=None) -> {found, running, exit_code, new_output, offset}`：按 session_id 取条目；`popen.poll()` 判是否结束；从 tmp_path 的 from_offset（缺省用条目存的 read_offset）按字节切行读增量（复用 skill_shell_backend 现有 `_read_incremental_from_tmp` 同款逻辑——把它抽成模块级函数共享，或在注册表内重写同款）；更新 read_offset；进程已退出则带回 exit_code。
  - `kill(session_id) -> {found, killed}`：`popen.kill()` + `popen.wait()`（显式回收防僵尸）；起进程时用进程组（POSIX `start_new_session=True` / Windows `creationflags=CREATE_NEW_PROCESS_GROUP`），kill 杀整组防孤儿子进程；标 status=killed。
  - sweep loop（后台 asyncio task 或惰性触发）：定期 `popen.poll()` 回收已退出条目（保留输出供最后一次 poll，超龄如 >2x execute_timeout 强杀），删对应 tmp_path。
- 后台路径放宽 1MB 上限：改为「尾部滚动保留」（如保留末 N KB，参考 hermes 200KB），避免长跑命令输出撑爆/被 break 截断。

### 块 2：aexecute 改造支持「超时转后台」

文件：`apps/server/src/service/skill_shell_backend.py`（`aexecute` ~335-616 + 线程侧 finally ~470-481）

- `aexecute` 加参数 `allow_background: bool = False`（或 `background_after` 语义）；工具层传入。
- async 侧超时分支（~565-585）：`timed_out` 且 `allow_background` 时——**不** `cancel_requested.set()`、**不** kill，而是把 `_proc_ref[0]`(Popen)、`_tmp_path`、当前 `last_size`(read_offset)、command 移交块1的 `register()`，返回 `ExecuteResponse(output=部分输出 + "\n[命令仍在后台运行，session_id=<id>，用 shell_poll(session_id) 查询进度、shell_kill(session_id) 终止]", exit_code=0)`（用 0 或一个非错误特殊码表示「正常转后台」，不要 124，避免模型误判失败）。
- 线程侧 finally（~470-481）：加「已转后台」标志（注册成功即置位）；置位时**跳过** kill 和 `os.unlink`（进程/文件交注册表）。读线程在转后台后退出（不再喂已无人消费的队列）；后台读增量改由 `shell_poll` 直接读 tmp_path。
- 不允许后台（`allow_background=False`，如某些受限场景）时维持现状（超时 kill+124）。

### 块 3：工具层（timeout 参数 + 两个新工具）

文件：`apps/server/src/service/agent/shell_execute_tool.py`

- `ShellExecuteInput`（~37-52）加 `timeout: int | None = None` 字段（描述告诉模型：前台等待上限秒数，超时命令转后台、返回 session_id，不会丢失，可用 shell_poll 继续查）。`_arun` 把它 + `allow_background=True` 传给 `aexecute`。
- 新增 `create_shell_poll_tool(registry)`：`StructuredTool.from_function`（照 ~83-96 模板），args = `session_id: str` + 可选 `offset`；调 `registry.poll(...)` 返回新增输出 + running/exit_code 给模型。
- 新增 `create_shell_kill_tool(registry)`：args = `session_id: str`；调 `registry.kill(...)`。
- 工具描述要明确引导模型：拿到 session_id 后**继续推进对话/或在需要结果时再 poll**，而非立刻空轮询刷屏（防 list_tasks 那种轮询死循环的前车之鉴 [[leader-list-tasks-poll-loop]]）。

### 块 4：注册新工具

文件：`apps/server/src/service/agent/employee.py`（~226）、`apps/server/src/service/agent/orchestrator/agent.py`（~281）

两处各把 `create_shell_poll_tool(registry)` / `create_shell_kill_tool(registry)` append 进 `extra_tools` / `orchestrator_tools`。registry 用块1的全局单例（import 取）。

### 块 5：恢复 read_timeout（独立提交）

文件：`apps/server/src/llm/factory.py:136`

块1-4 落地验证后，把 `read_timeout = None` 改回 `min(180.0, req_timeout)`（对齐 `agent_chunk_timeout` 默认 180s）。理由：转后台后命令不再占 LLM 连接，read 回到「纯模型生成 chunk 间隙」，有限值能让模型真挂死/半开连接更快被 httpx 断连重连（max_retries=2），不必干等 900s watchdog。不低于 90s（summarization 中间件单请求可能 >90s）。**独立 commit，便于单独回滚。**

### 不在本期范围

- watch_patterns / 完成通知 / 崩溃恢复落盘（hermes 有，超出最小可用）。
- 前台轻命令的执行模型不变（同步轮询那套已够）。
- 总管/员工以外的命令路径。

## 数据流（修复后）

agent 调 `shell_execute(command, timeout=90)` → aexecute 前台跑，90s 内完成则同步返回结果（现状）；90s 未完成 → 不 kill，Popen/tmp_path 移交全局注册表、返回 session_id+部分输出 → agent 拿到立刻继续（LLM 连接不再空等）→ 需要结果时调 `shell_poll(session_id)` 读增量/查状态，或 `shell_kill(session_id)` 终止。模型真挂死由恢复后的 180s read + 应用层 watchdog 收。

## 测试

后端 pytest（`cd apps/server && uv run pytest`）：
- 注册表单测（新 test 文件）：register→poll 读增量（按 offset 切行正确、running/exit_code 反映进程态）；kill 杀进程并标 killed；poll 不存在的 session_id 返回 found=False；sweep 回收已退出条目。用真实短命令（`sleep`/`echo` 或跨平台等价）起 Popen 验证。
- aexecute 转后台：构造一个「超过 timeout 仍在跑」的命令 + `allow_background=True` → 返回含 session_id、exit_code 非 124（转后台正常码）、进程未被 kill（poll 注册表能查到 running）；`allow_background=False` → 维持超时 kill+124。
- 工具层：`ShellExecuteInput` 接受 timeout 字段；shell_poll/shell_kill 工具 schema 正确、调通注册表。
- read_timeout（块5）：复用上一轮 `test_llm_factory_timeout.py`——改断言 `t.read == 180.0`（或 min 结果），connect/write/pool 仍有限。
- 手动验证：那条双重全递归扫盘命令 → 90s 内没完转后台、agent 继续、session_id 可 poll 到进度、可 kill；普通快命令仍同步秒回。

## 风险

- **孤儿子进程**（Windows 尤甚）：`shell=True` 起的进程 kill 只杀 shell，子孙漏。缓解：后台进程用进程组起、kill 杀整组（块1明确）。务必跨平台验证。
- **临时文件泄漏**：转后台后文件交注册表，进程结束/kill/超龄由 sweep 删；若 sweep 漏则泄漏。缓解：sweep 兜底 + 进程退出即标记待删。
- **模型空轮询刷屏**：拿到 session_id 后狂 poll。缓解：工具描述引导「需要时再 poll」；必要时可加同 session 短时间多次 poll 的软提示（参考 list_tasks 硬闸经验，本期先靠描述，不加硬闸）。
- **read 恢复时机**：块5 必须在块1-4 落地验证后再改，否则回到「长命令被 HTTP 误杀」老问题；独立提交便于回滚。
- **aexecute 是核心高频路径**：改超时分支/finally 风险高，需保证「不转后台时行为完全不变」（allow_background=False 走原路径），加测覆盖两条路径。
- 全局单例注册表跨会话共享 session_id：uuid 随机不可猜，实际隔离够用；本期不做按会话分区（YAGNI）。
