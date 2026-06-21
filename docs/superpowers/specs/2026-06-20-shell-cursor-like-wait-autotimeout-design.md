# shell 命令像 Cursor：模型自估超时 + shell_wait 等结果 设计

日期：2026-06-20
状态：设计待评审

## 背景与问题

用户要的是 Cursor/Claude Code 式的 shell 执行体验：**模型按任务强度自己决定超时、长任务转后台后自己 sleep 一段再回来看**，整体不卡。上一轮（2026-06-19）已做好基础设施：`shell_execute(timeout)` 超时转后台 + `shell_poll`/`shell_kill` + 全局后台进程注册表 + 进程组防孤儿。但仍未达成 Cursor 体验，缺三处：

1. **模型「自己 sleep 去看」没有工具**：现在只有 `shell_poll`（查一次立即返回）。模型要么立刻 poll（空轮询刷屏），要么不 poll。缺一个「阻塞等命令结束或最多 N 秒」的等待机制（= hermes 的 `process(action='wait')`、Cursor 的「自己 sleep 去看」）。
2. **后端默认 timeout 是 1200s，模型不传就等于「没超时」**：`shell_execute` 的工具层不传 timeout 时，落到 backend `_default_timeout = settings.execute_timeout*2 = 1200s`（`employee.py:191`、`orchestrator/agent.py:228`）。从用户体感看，长命令「没超时」（要等 20 分钟才转后台）。
3. **prompt 完全没教模型这套用法**：orchestrator prompt（`prompts.py`）只有一句「别自己跑 shell_execute 代替员工」，没讲「按任务强度估 timeout、转后台后用 shell_wait 等结果、勿空轮询」。工具能力齐了但模型不会用。

## 设计决策（已与用户确认）

- 新增 **`shell_wait(session_id, max_seconds)`** 工具（阻塞等命令结束或最多 max_seconds，有硬顶防死等）——这是「模型自己 sleep 去看」的落点。
- 超时时间 **模型自估 + 合理默认兜底**：prompt 教模型按任务强度估 timeout；同时把「工具层不传 timeout 时的前台默认」设为 **60s**（模型忘传也不会等太久）。
- 60s 作为默认前台超时（查询类基本 60s 内完成不转后台；长命令 60s 转后台）。

## 范围

后端，4 块（均在上一轮基础设施之上，不重做转后台/注册表/poll/kill）。

### 块 1：新增 shell_wait 工具

文件：`apps/server/src/service/shell_background_registry.py`（加 wait 方法）+ `apps/server/src/service/agent/shell_execute_tool.py`（加工具工厂）

- 注册表加 `wait(session_id, max_seconds) -> dict`：循环 `popen.poll()` + 读增量，直到进程结束或累计等待达 `min(max_seconds, _WAIT_HARD_CAP)`（硬顶如 300s 防死等）。返回 `{found, finished, exit_code, new_output, offset, waited_seconds}`。等待用 `time.sleep` 短间隔轮询（如每 0.5s）；这是同步阻塞调用，跑在工具执行线程，不占 LLM 连接。
- `create_shell_wait_tool()`：`StructuredTool.from_function`，args `session_id: str` + `max_seconds: int`（默认如 60）。调 `registry.wait(...)`，返回格式化字符串（完成→给最终输出+exit_code；未完成→「等了 Ns 仍在运行，已有增量…，可再 shell_wait 或 shell_poll」）。
- 在员工（`employee.py`）+ 总管（`orchestrator/agent.py`）两处注册（与 poll/kill 并列 append）。

### 块 2：工具层默认前台 timeout 改 60s（兜底）

文件：`apps/server/src/service/agent/shell_execute_tool.py`

- 现状：`_arun` 不传 timeout 时 → `aexecute` 用 backend `_default_timeout`(1200s)。
- 改：`ShellExecuteInput.timeout` 默认仍 None（模型可传）；但 `_arun` 在 `timeout is None` 时传一个 **`DEFAULT_FOREGROUND_TIMEOUT = 60`** 给 `aexecute`（而非让它落到 1200s 的 `_default_timeout`）。即：模型传了用模型的，没传用 60s。
- backend 的 `_default_timeout`（1200s）保留不动——它是「命令绝对上限」语义（转后台后注册表也有 `_MAX_AGE_SECONDS=3600` 兜底），与「前台默认超时」是两回事，不混淆。
- 模型显式传很大的 timeout（如想前台等久）仍被尊重。

### 块 3：prompt 教模型 Cursor 式行为

文件：`apps/server/src/service/agent/orchestrator/prompts.py` + 员工 prompt（`employee.py` 里的 system prompt 或对应 prompt 文件——实现时定位）

加一段 shell 用法指引（两处同义）。**核心：短命令零负担，只有预判的长任务才走超时/后台/wait 这套**：
```
执行 shell 命令默认什么都不用管——一般命令（查目录/取数/echo/git 等几秒内完成的）直接调 shell_execute、不传 timeout、同步拿结果，不要为它们设 timeout 或想 shell_wait。
仅当你**预判这是个长任务**（扫盘、递归算大目录大小、编译、下载、安装依赖等可能跑很久）时，才：① 给一个较大的 timeout（如 120-300s）让它前台多等会儿，或 ② 接受它超时（默认 60s）自动转后台、返回 session_id，然后用 shell_wait(session_id, N) 阻塞等结果（N 按预估剩余时长、最多 300s），而不是反复 shell_poll 空轮询。
绝不要对刚转后台的命令立刻连续 poll 刷屏；确实不必等就先做别的、需要结果时再 shell_wait/shell_poll。
```

### 块 4：工具描述强化

文件：`apps/server/src/service/agent/shell_execute_tool.py`

- `ShellExecuteInput.timeout` 描述补：**一般命令不用传**（默认 60s，几秒内完成的会同步返回）；仅预判长任务（扫盘/编译/下载）时才传较大值（如 120-300s）让它前台多等，否则超时自动转后台返回 session_id。
- `shell_wait` 描述：阻塞等命令结束或最多 N 秒，**长任务转后台后**等结果优先用它而非空轮询 poll。
- `shell_poll` 描述补：仅需快速查一次时用；要「等结果」用 shell_wait。

### 不在本期范围

- 转后台/注册表/poll/kill/进程组（上一轮已做，不重做）。
- 「慢/不平滑」体感问题（独立，待 dev 模式排除结论）。
- backend `_default_timeout` 1200s 绝对上限不改。

## 数据流（修复后）

模型估 timeout（或不传→60s）调 `shell_execute` → 60s/估值内完成则同步返回 → 超时未完成转后台返回 session_id → 模型用 `shell_wait(session_id, N)` 阻塞等（线程内 sleep 轮询，不占 LLM、不刷屏）→ 完成则拿结果，未完成则继续 wait 或先干别的。prompt 引导模型「估时长 + 转后台后 wait」，达成 Cursor 式自主编排。

## 测试

后端 pytest（`cd apps/server && uv run pytest`）：
- 注册表 `wait`：register 一个「跑 1s 的进程」+ `wait(sid, 5)` → finished=True、exit_code 反映、含输出；register 一个「跑 30s 的进程」+ `wait(sid, 1)` → finished=False、waited≈1、有/无增量；硬顶：`wait(sid, 9999)` 不超过 _WAIT_HARD_CAP。
- 工具：`create_shell_wait_tool().invoke({"session_id":..,"max_seconds":..})` 返回 str；poll/kill 不回归。
- 默认 timeout：`_arun` 不传 timeout 时传给 aexecute 的是 60（用 monkeypatch/spy 验证传入值，或验证一个 >60s 命令在不传 timeout 时 60s 转后台）。
- prompt：若 prompt 测试断言文案则更新；至少 import 冒烟两个 prompt 模块不报错。
- 手动验证：让总管跑一个慢命令（扫盘）→ 60s 自动转后台、模型用 shell_wait 等、不空轮询刷屏；快命令秒回不转后台。

## 风险

- **shell_wait 阻塞工具线程**：wait 是同步 sleep 轮询，占一个工具执行线程最多 max_seconds。须有硬顶（_WAIT_HARD_CAP=300s）防模型传超大值死占线程；线程池已扩到 64（orchestrator-silent-stall），可接受。
- **模型仍空轮询**：靠 prompt + 工具描述引导，本期不加硬闸（参考 list_tasks 死循环经验，先描述引导，观察后再决定加不加）。
- **默认 60s 误转后台正常稍慢命令**：60s 内完成的不受影响；60-120s 的正常命令会转后台、模型需多一步 wait——可接受（模型估 timeout 大些即可前台等）。
- **wait 与 poll 的 offset 一致**：wait 也按注册表 read_offset 读增量，与 poll 共用同一 offset 推进，避免重读/漏读——实现时复用注册表的 `_read_incremental` + offset 更新。
- backend `_default_timeout` 不动，避免影响「绝对上限/超龄回收」语义。
