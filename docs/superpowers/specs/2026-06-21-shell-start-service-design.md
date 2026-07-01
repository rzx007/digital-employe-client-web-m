# 子项目 B：start_service 起常驻服务 设计

日期：2026-06-21
状态：设计待评审

## 背景与问题

「三类完整设计」的第二个子项目。A（[[shell-rhythmic-wait-cursor-style]]，已合 dev）解决了「慢但会结束的命令」——模型有节奏 shell_wait 等。但还有一类命令**永远不会自己结束**：dev server、`uvicorn ... --reload`、`pnpm dev`、worker——它们是**常驻服务**。

现状：模型起这类命令只能用 `shell_execute`。它会一直等 timeout（默认 60s）然后转后台——语义全错：① 服务本就不该「等结束」，等的是「**就绪**」（它开始服务了）；② 转后台的部分输出对「服务起没起来」毫无判断力；③ 服务永不结束，60s 后转后台、又被注册表 `_MAX_AGE_SECONDS=3600` 在 1h 后误杀。模型也无从知道「服务已经在 127.0.0.1:xxxx 跑起来了，可以接着调试了」。

Node 侧 Electron 主进程有现成蓝本 `apps/web/electron/core/services/managed-process.ts`（管应用自己的后端）：spawn + 就绪检测（stdout 关键词 / HTTP 健康）+ fatal 日志快速失败 + 进程树 kill。但它在 Electron 主进程，**agent 工具（Python 侧）够不着**——B 把它的**就绪模式移植到 Python**，不复用代码。

## 核心洞察

常驻服务 = **永不自己结束的后台命令**，等的是「就绪」而非「退出」。所以 B **不新建生命周期**，而是给现有 `shell_background_registry`（A/上一轮已落地：进程组 Popen + offset 增量读 + killpg/taskkill /T + sweep）加一个「**服务**」标记 + 就绪检测 + 一个新工具，看日志/停服务**复用 A 的 shell_poll/shell_wait/shell_kill**。

## 设计决策（已与用户确认）

- 工具面：**新建专用 `start_service` 工具**（不在 shell_execute 加 service 参数）——边界最清，模型显式选。
- 就绪检测：**三种都支持，模型选** —— `stdout` 关键词命中 / `http` 健康探活 / `wait` 纯等 N 秒兜底（对齐 Node 蓝本）。
- 生命周期：**免 3600s 回收 + 模型 stop_service + 进程退出兑现都杀** —— 服务注册为 `is_service=True` 免 sweep 强杀；模型用 `shell_kill` 停；后端进程退出时 atexit 把所有服务进程组杀干净（防泄漏残留 dev server）。
- 看后续日志/停服务：**复用 shell_poll/shell_wait/shell_kill**（`service_id` 即 `session_id`），零新增「看/停」工具。

## 范围

后端，4 块（均在现有注册表基础设施之上）。

### 块 1：注册表加「服务」支持

文件：`apps/server/src/service/shell_background_registry.py`

- `_Session` dataclass 加字段 `is_service: bool = False`。
- `register(...)` 加形参 `is_service: bool = False`，写入 `_Session`。
- `sweep()` 中 `_MAX_AGE_SECONDS` 超龄强杀的分支**跳过 `s.is_service`**（服务永不超龄回收；它由 stop_service/atexit 管）。其余（已结束进程的文件清理）不变。
- 新增 `kill_all_services() -> int`：遍历所有 `is_service` 且仍在跑的 session，`_terminate` 杀进程组、清文件、置 status="killed"，返回杀掉个数。供 atexit 兜底。

### 块 2：就绪检测器（移植 Node 蓝本）

文件：新建 `apps/server/src/service/service_readiness.py`

一个同步函数 `wait_for_service_ready(*, popen, tmp_path, ready, host, port, ready_timeout, fatal_patterns, read_offset) -> dict`：

- 三种 `ready` 模式（`ready` 是 dict，含 `type`）：
  - `{"type": "stdout", "pattern": "..."}`：循环读临时文件增量（复用注册表的 `_read_incremental` 逻辑或等价实现）找 `re.search(pattern)` 命中。
  - `{"type": "http", "path": "/", "interval": 0.5}`：循环 `http.client`/`urllib` GET `http://{host}:{port}{path}`，状态码 2xx-4xx 算就绪。
  - `{"type": "wait", "seconds": N}`：纯 `time.sleep` 等 N 秒（兜底）。
- 每轮先检查：① `popen.poll()` 非 None → 进程启动即退出 → 返回 `{ready:False, exited:True, exit_code}`；② 新增输出里命中任一 `fatal_patterns`（如 `Address already in use`）→ 返回 `{ready:False, fatal:True, fatal_line}`；③ 累计超 `ready_timeout` → 返回 `{ready:False, timed_out:True}`。
- 就绪 → 返回 `{ready:True, new_output, offset}`。
- 同步阻塞跑工具线程（与 shell_wait 同模型），轮询间隔如 0.5s。`ready_timeout` 有硬顶（如 120s）防死等。

### 块 3：start_service 工具

文件：`apps/server/src/service/agent/shell_execute_tool.py`（加工厂 `create_start_service_tool`）

- 入参 schema：`command: str`、`ready: dict | None`（默认 `{"type":"wait","seconds":8}`）、`cwd: str | None`、`ready_timeout: int = 30`、`host: str = "127.0.0.1"`、`port: int | None`、`fatal_patterns: list[str] | None`。
- host 只允许 `127.0.0.1`/`localhost`（对齐 Node 蓝本安全约束），否则报错返回。
- 复用现有起进程逻辑：进程组 Popen（`CREATE_NEW_PROCESS_GROUP`/`start_new_session`）、stdout→临时文件。**实现时优先复用 `skill_shell_backend` 已有的起进程+临时文件代码路径**，避免重复；若不易复用则在工具内最小起进程（同样进程组 + 临时文件）。
- `registry.register(..., is_service=True)` 拿 `service_id`。
- 调 `wait_for_service_ready(...)`，按返回组织文本：
  - ready → `[服务已就绪] service_id={id}\n启动输出:...\n[可用 shell_poll(service_id) 看日志、shell_kill(service_id) 停服务]`
  - exited → `[服务启动即退出 exit_code=X] 可能不是常驻命令或配置有误:\n<输出>`（已退出，文件清理走正常路径）
  - fatal → 杀掉进程 + `[起服务失败] <fatal_line>`
  - timed_out → **不杀** + `service_id={id} [尚未就绪,已等Ns] 服务可能仍在启动,用 shell_poll(service_id) 继续看,或 shell_kill 停。`

### 块 4：注册 + atexit + prompt

文件：`employee.py`、`orchestrator/agent.py`、`shell_background_registry.py`（或 server 启动处）、`orchestrator/prompts.py`、`prompts.py`

- `create_start_service_tool()` 在员工 + 总管两处注册（与 shell_wait/poll/kill 并列 append）。
- atexit 钩子注册一次（注册表模块 import 时 `atexit.register(get_background_shell_registry().kill_all_services)`，或 server.py 启动处），进程退出兜底杀所有服务。
- 两套 prompt 各加一句：起**常驻服务**（dev server / uvicorn / `pnpm dev` 这种不会自己结束的）用 `start_service` 并指定 ready；**别**用 shell_execute 跑它（会一直等 timeout 转后台、语义不对、还可能被回收）。

### 不在本子项目范围

- C：超长任务完成唤醒 —— 后续子项目。
- 服务健康持续监控 / 崩溃自动重启 —— YAGNI。
- 把服务暴露到前端 UI / 端口展示 —— YAGNI。
- 转后台/注册表 poll/kill/进程组/A 的 shell_wait（已落地，不重做）。

## 数据流（B 落地后）

模型判断「起常驻服务」→ `start_service(command, ready={...})` → 注册表起进程组(is_service=True)、stdout→临时文件 → `wait_for_service_ready` 按 ready 模式检测 → 就绪返回 service_id+输出 / fatal 杀+报错 / 启动即退出报错 / 超时不杀返回 service_id 让模型 poll → 模型续看日志 shell_poll/shell_wait、停服务 shell_kill → 后端进程退出 atexit kill_all_services 兜底杀净。

## 错误处理

- 命令启动即退出（写错了/非服务）→ `exited` 分支，报 exit_code + 输出。
- ready_timeout 超时 → **不杀**（dev server 可能就是慢），返回 service_id 让模型 shell_poll 判断。
- fatal_patterns 命中（端口占用）→ **杀掉**并返回致命行（再等无用）。
- host 非本地 → 直接报错返回，不起进程。

## 测试

后端 pytest（`cd apps/server && uv run pytest`）：
- 就绪检测器 `wait_for_service_ready`：
  - stdout 模式：起一个「sleep 后打印就绪行」的子进程 + pattern 命中 → ready=True；pattern 永不命中 + 短 ready_timeout → timed_out=True。
  - http 模式：起一个 python `http.server` 子进程 + 探活通 → ready=True；端口不通 + 短 timeout → timed_out。
  - wait 模式：seconds=1 → 约 1s 后 ready=True。
  - fatal：子进程打印 `Address already in use` + fatal_patterns 含之 → fatal=True+fatal_line。
  - 启动即退出：子进程立即 exit(3) → exited=True+exit_code=3。
- 注册表：`register(is_service=True)` 的 session `sweep()` 即使超龄也不被强杀（monkeypatch _MAX_AGE_SECONDS=0 验证 service 存活、非 service 被回收）；`kill_all_services()` 杀掉所有服务并返回个数。
- start_service 工具：起一个真「假服务」（打印就绪行后 sleep 的脚本）→ 返回含 `service_id` + 就绪文案；该 service_id 能被 `shell_poll`/`shell_kill` 接住（收尾 kill）。host 非本地 → 报错文案。
- 两处注册 import 冒烟；两套 prompt 含 `start_service` 关键词。
- 测试坑（沿用 A）：Win 上 taskkill /F /T 活子进程会带走 pytest → 测停服务让子进程能被进程组杀且断言后收尾；http 子进程用 127.0.0.1 + 随机/固定端口、测完 kill。

## 风险

- 就绪检测阻塞工具线程最多 ready_timeout（硬顶 120s）——线程池 64，可接受（与 shell_wait 同）。
- atexit 在某些强杀（SIGKILL 后端进程本身）下不触发 → 残留服务；但正常退出/重启覆盖大多数场景，且 sweep 仍会在「非 service 误标」时兜底——服务泄漏是「尽力而为」，可接受（YAGNI：不引入额外守护进程）。
- http 就绪探活需模型知道 port——模型不传 port 时 http 模式无法工作，工具需校验 http 模式必须有 port，否则报错引导改用 stdout/wait。
- 模型可能仍用 shell_execute 起服务 → 靠 prompt + 工具描述引导，本子项目不加硬闸（沿用 A 的「先描述、观察后再决定」策略）。
- `ready` 默认 `wait` 兜底秒数若太短→服务没起好就返回 ready；模型可按服务调大或改 stdout/http。文档说明默认仅兜底。
