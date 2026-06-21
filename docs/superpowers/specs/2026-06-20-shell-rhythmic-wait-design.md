# 子项目 A：shell 命令像 Cursor 有节奏地等，超大才升级通知 设计

日期：2026-06-20
状态：设计待评审

## 背景与问题

用户要 Cursor 式 shell 体验。上一轮已做好基础设施（`shell_background_registry` 注册表 + `shell_execute(timeout)` 超时转后台 + `shell_poll`/`shell_kill`）。但模型行为不对：遇长任务**不耐心等，反而狂试错**——查一下没好就 `shell_kill` 杀掉、换个命令重试，反复刷屏（实测截图：扫盘慢 → poll/poll/kill → 立刻换并行方式重扫），结果本来静静等一会就好的任务永远做不成。

用户提出的正解（Cursor 方式）：命令转后台后，模型**自己决定隔 30-60s 有节奏地回来看一眼**（不是立刻撒手、也不是狂查）；**只有看几轮发现是真·超大任务**（远未完、预估还很久）时，才告知用户「这任务较久、稍后问我进度」收尾。绝大多数慢命令（几十秒~两三分钟）模型自己等着就拿到结果、用户无感；只有真超长的才打扰用户。

本子项目 A 是「三类完整设计」拆分中的第一个（最小最快），只解「模型该耐心时别狂试错」。B（常驻服务 start_service）、C（超长任务完成唤醒）是后续独立子项目。

### 现状缺口

- **没有「阻塞等 N 秒」的工具**：现只有 `shell_poll`（查一次立即返回）。模型要「隔 30-60s 看一眼」只能反复 poll 或在命令里 sleep → 刷屏。缺 `shell_wait(session_id, max_seconds)`（上一轮 spec `2026-06-20-shell-cursor-like-wait-autotimeout-design.md` 设计过但搁置未实现）。
- **工具不传 timeout 落到 1200s**：`shell_execute` 工具层不传 timeout → backend `_default_timeout`(1200s)，长命令体感「没超时」。
- **prompt 没教这套节奏**：模型不知道「转后台后有节奏等、超大才升级通知、绝不杀了重试」。

## 设计决策（已与用户确认）

- 模型「有节奏地自己等几轮」**用 shell_wait 工具**（阻塞等命令结束或最多 N 秒）。
- 等多久/几轮升级到「告诉用户」**由模型自己拿捏**（prompt 给原则，不写死秒数）。
- 升级通知话术写「**稍后问我进度**」——**不承诺自动通知**（C 完成唤醒还没做，承诺了是空诺）。C 做完再改成「完成会自动告诉你」。
- A 范围 = shell_wait 实现 + 默认 60s + prompt 引导（复用搁置那轮的块1/块2，叠加新 prompt 行为）。

## 范围

后端 4 块。块1/块2 直接复用搁置 spec `2026-06-20-shell-cursor-like-wait-autotimeout-design.md` 的设计（其 plan `2026-06-20-shell-cursor-like-wait-autotimeout.md` 的 Task 1-3 代码可照用）；块3 是本子项目的核心新增。

### 块 1：shell_wait 工具（复用搁置 spec 块1）

文件：`apps/server/src/service/shell_background_registry.py` + `apps/server/src/service/agent/shell_execute_tool.py` + 两处注册（`employee.py`、`orchestrator/agent.py`）

- 注册表加 `wait(session_id, max_seconds) -> {found, finished, exit_code, new_output, offset, waited_seconds}`：循环 `popen.poll()` 短间隔（0.5s）轮询，等命令结束或累计 `min(max_seconds, _WAIT_HARD_CAP=300)`。同步阻塞跑工具线程，不占 LLM。读增量复用 `_read_incremental` + 推进 read_offset（与 poll offset 一致）。
- `create_shell_wait_tool()`：args `session_id` + `max_seconds`(默认60)。返回：完成→最终输出+exit_code；未完成→「等了 Ns 仍在运行，已有增量…，可再 shell_wait 或先做别的」。
- 员工 + 总管两处 append `create_shell_wait_tool()`（与 poll/kill 并列）。

### 块 2：工具层不传 timeout 默认 60s（复用搁置 spec 块2）

文件：`apps/server/src/service/agent/shell_execute_tool.py`

- `_arun` 在 `timeout is None` 时传 `DEFAULT_FOREGROUND_TIMEOUT=60` 给 `aexecute`（而非落到 backend 1200s）。模型传了用模型的。
- backend `_default_timeout`(1200s 绝对上限) 不动。

### 块 3：prompt 教「有节奏等、超大才升级通知、绝不试错重试」（A 核心新增）

文件：`apps/server/src/service/agent/orchestrator/prompts.py`（`ORCHESTRATOR_SYSTEM_PROMPT_TEMPLATE`）+ `apps/server/src/service/agent/prompts.py`（员工 `build_system_prompt`）

两处同义加一段（核心区别于搁置那轮的「立刻收尾」——改为「有节奏等、超大才升级」）：
```
执行 shell 命令：一般命令（查目录/取数/echo/git 等几秒内完成）直接 shell_execute、不传 timeout、同步拿结果，别为它们设 timeout 或想 wait。
命令较慢超时会自动转后台、返回 session_id（输出不丢失）。此时**有节奏地等**，别狂查也别撒手：用 shell_wait(session_id, N)（N 自定，如 30-60s）等一轮，没完成就再 shell_wait 等一轮——绝大多数任务等一两轮就完成、直接拿结果给用户。
只有当你等了几轮、判断这是个**真·超大任务**（远未完、预估还要很久，如拉大镜像/全盘扫描/大型编译）时，才告诉用户「这个任务较耗时、已在后台运行，你可以稍后问我进度（我用 shell_poll 查）」并体面收尾本轮——不要因为「还没完成」就 shell_kill 杀掉重试、或换个命令重来。命令没报错就是在正常跑，耐心等。
```

### 块 4：工具描述强化

文件：`apps/server/src/service/agent/shell_execute_tool.py`

- `ShellExecuteInput.timeout`：一般命令不用传（默认 60s 内同步返回）；预判长任务才传较大值，否则超时转后台。
- `shell_wait`：阻塞等命令结束或最多 N 秒，转后台后**有节奏地等结果优先用它**（每轮 30-60s），而非空轮询 poll。
- `shell_poll`：仅快速查一次时用；要「等结果」用 shell_wait。

### 不在本子项目范围

- B：常驻服务 start_service（dev server）—— 后续子项目。
- C：超长任务完成唤醒（命令跑完自动拉模型回来）—— 后续子项目。话术因此写「稍后问我进度」不承诺自动通知。
- 转后台/注册表/poll/kill/进程组（上一轮已做，不重做）。

## 数据流（A 修复后）

模型估 timeout（或不传→60s）调 shell_execute → 短命令同步返回 → 慢命令 60s/估值转后台返回 session_id → 模型 shell_wait(N) 有节奏等一轮 → 完成则给结果；未完成再 wait 一轮 → 等几轮仍远未完且预估超大 → 告知用户「较久、稍后问我进度」收尾，不 kill 重试。

## 测试

后端 pytest（`cd apps/server && uv run pytest`）：
- 注册表 `wait`：跑1s进程+wait(5)→finished+输出；跑30s进程+wait(1)→未完成+waited≈1（收尾kill）；硬顶 _WAIT_HARD_CAP；unknown session→found False。
- `create_shell_wait_tool().invoke(...)` 返回 str；unknown→「未找到」。
- 默认60s：`_arun` 不传 timeout 时传给 aexecute 的是 60（spy/monkeypatch 验证）；传值则用传值。
- 两处注册 import 冒烟。
- prompt：含「有节奏等」「超大才升级」「绝不 kill 重试」类指引；若 prompt 测试断言文案则更新。
- 手动验证：让总管跑慢命令（扫盘）→ 模型 shell_wait 有节奏等、不刷屏不杀重试；真超大才说「稍后问我进度」；快命令秒回不转后台。

## 风险

- shell_wait 阻塞工具线程最多 max_seconds（硬顶300s）——线程池64，可接受。
- 模型仍不听话乱试错 → 靠 prompt + 工具描述引导，本子项目不加硬闸（list_tasks 死循环经验：先描述，观察后再决定）。
- 「超大任务」判定靠模型主观——可接受，prompt 给原则（远未完/预估很久/拉镜像类）。
- 话术「稍后问我进度」是 C 未做前的诚实兜底；C 做完须回来改成「完成自动通知」。
