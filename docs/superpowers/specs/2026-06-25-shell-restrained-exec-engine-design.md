# 克制版命令执行引擎 + 后台任务面板 设计

日期：2026-06-25
状态：设计待评审
关联：参考被排除的 v2（[[shell-timeout-to-background]] / [[shell-rhythmic-wait-cursor-style]] / start_service / 自动唤醒），本期**只取其低风险的受控子集**，并新增前端可见面板。

## 背景与目标

用户对标 Claude Code 的命令执行体验：长命令**转后台/直接后台**跑、agent **同一轮内交错**做别的、后台任务在一个**可见可点击的面板**里显示 Running/Finished + 计时 + 点开看输出。

历史上一套完整的「执行引擎 v2」（timeout→后台 + shell_wait/poll/kill + start_service + 自动唤醒）已被构建并测试，但在 `4621ae0c` 选择性合并时被当作「高风险/违背理念」整体排除——核心风险在 **start_service**（常驻服务生命周期、泄漏）与 **自动唤醒**（后端主动重驱动已结束会话，resume 热循环/僵尸流之源，耦合 SSE 内核）。

本期目标：**重新设计一套克制方案**，达成 Claude Code 式体验，但：
- ✅ 取被排除 v2 中**低风险、不碰会话生命周期**的受控子集（注册表 + timeout→后台 + poll/wait/kill）。
- ✅ 新增 Claude Code 没有、但用户明确要的 **run_in_background 直接后台** 与**前端可见后台任务面板**。
- ❌ **不做** start_service（用户工作负载无常驻服务需求）。
- ❌ **不做** 自动唤醒（最高风险）——**用可见面板替代**「完成通知」：面板自己显示 Finished，用户点开/再问一句即可，后端绝不主动重驱动已结束会话。

### 工作负载（已确认）
- 几乎都是短命令（秒级~两三分钟）。
- **经常有小时级长任务**（拉大镜像/全盘扫描/大型编译）。
- 不常起常驻服务。

## 现状（master/本分支，已坐实 file:line）

- `apps/server/src/service/agent/shell_execute_tool.py`：仅 `create_shell_execute_tool`，`ShellExecuteInput` 只有 command/intent，**无 timeout / run_in_background**；`_arun` 调 `shell.aexecute(command, tool_call_id=...)` 不传 timeout → 落 backend `_default_timeout`（≈1200s 死等）。
- `apps/server/src/service/skill_shell_backend.py`：`aexecute` 已是「stdout→临时文件 + 增量流式 + 30s keepalive + 超时 kill 返回 124」，但**无转后台**、进程**未用进程组起**（Windows 易留孤儿）。
- 无后台进程注册表；无 poll/wait/kill 工具。
- 前端 `chat-layout.tsx` 右栏面板注册表 `RightPanel = "artifact"|"monitor"|"browser"|"subtask"|"employee-tasks"`；面板模式 = 可见性 store + TanStack Query 轮询 REST + `useWorkspaceEvents` SSE 失效刷新 + `reset-chat-right-panels.ts` 统一关。**无 shell 后台任务面板**。
- `factory.py:136` 当前 `read_timeout`（确认本期是否仍为 None，若是则块8 恢复 180）。

## 设计决策

| 维度 | 决策 |
|------|------|
| 后台进入方式 | **两条**：① `run_in_background=True` 直接后台（Claude Code 式，立即返回 session_id 不等）；② `timeout` 内没跑完**自动转后台**（不 kill） |
| 注册表 | 进程级全局单例 `BackgroundShellRegistry`；条目带 `workspace_id/conversation_id/intent/started_wall` 供面板按会话过滤、显示 |
| 进程组 | Popen 用进程组起（POSIX `start_new_session` / Win `CREATE_NEW_PROCESS_GROUP`），kill 杀整组（killpg / taskkill /T），治孤儿 |
| **sweep（关键 redesign）** | **绝不按龄强杀 running 任务**（小时级任务合法）；只回收 **finished** 条目，且**保留一段时间**（默认 30 分钟）供面板显示 Finished；finished 超保留窗 + tmp 文件清理后移除 |
| 进程退出兜底 | atexit 杀**所有** running 后台进程（防泄漏），非仅 service |
| 完成通知 | **可见面板 + 轮内交错**；**无自动唤醒**。面板显示 Finished，用户点开/再问；agent 在活跃轮内 poll/wait |
| 安全 | 沿用现有 `check_hardline` + 越界守卫，本期**不加** claw-code 式命令分级（属另一子项目 B，超范围） |

## 范围

### 后端

#### 块 1：后台进程注册表（新建）
文件：`apps/server/src/service/shell_background_registry.py`

- `_Session` dataclass：`popen, tmp_path, read_offset, command, started_at(monotonic), started_wall(epoch float), status("running"|"finished"|"killed"), workspace_id:int|None, conversation_id:int|None, intent:str|None, exit_code:int|None=None, finished_at(monotonic)|None`。**不含 is_service**。
- `register(*, popen, tmp_path, read_offset, command, workspace_id, conversation_id, intent) -> sid(uuid)`。
- `poll(sid, from_offset=None) -> {found, running, exit_code, new_output, offset}`：复用 `_read_incremental`；进程退出时置 status=finished、记 exit_code、finished_at。
- `wait(sid, max_seconds) -> {found, finished, exit_code, new_output, offset, waited_seconds}`：同步轮询 popen.poll() 0.5s 间隔，硬顶 `_WAIT_HARD_CAP=300`。
- `kill(sid) -> {found, killed}`：`_terminate` 杀进程组 + wait(5) + status=killed + 立即清 tmp 文件。
- `_terminate(popen)`：跨平台杀整组（Win: CTRL_BREAK→taskkill /F /T→popen.kill；POSIX: killpg(SIGKILL) 兜底 popen.kill）。
- `sweep()`：遍历快照——running 不动（**取消按龄强杀**）；刚发现 finished 的记 finished_at、清 tmp 文件但**保留条目**；finished 超 `_FINISHED_RETENTION=1800s` 的移除条目。
- `list_snapshot(workspace_id, conversation_id=None) -> list[dict]`：面板数据源；返回 `{session_id, command, intent, status, running, exit_code, started_wall, elapsed_seconds}`（按 started_wall 倒序）。
- `kill_all() -> int`：atexit 兜底杀所有 running。
- 模块级 `get_background_shell_registry()` 单例 + `_register_atexit_once()`（`atexit.register(...kill_all)`）。

#### 块 2：aexecute 支持转后台 + 直接后台
文件：`apps/server/src/service/skill_shell_backend.py`

- Popen 改进程组起（`_pg_kwargs`，见 v2 实现）。
- `aexecute(..., timeout, tool_call_id, allow_background=False, run_in_background=False, workspace_id=None, conversation_id=None, intent=None)`：
  - **直接后台**：`run_in_background=True` 时，起进程组 + stdout→临时文件后**立刻** `register(...)` 返回 session_id 指引，不进流式等待循环。
  - **超时转后台**：沿用 v2 ——超时分支若 `allow_background` 且进程仍在跑，**不 kill**，把 popen/tmp_path/last_size 移交 `register(...)`，线程 finally 据 `_background_handoff` 跳过 unlink；返回 partial + session_id 指引。register 传入 workspace_id/conversation_id/intent。
  - `allow_background=False`（无该能力的受限路径）维持现状（超时 kill+124）。
- 话术（at-handoff note）：去掉 v2 里的 `watch_background` 一句（本期无自动唤醒），改为「要结果用 shell_wait(N) 有节奏等；判断超大任务就告诉用户『已在后台，稍后可在后台任务面板查看或问我进度』并体面收尾，勿杀了重试」。

#### 块 3：工具层
文件：`apps/server/src/service/agent/shell_execute_tool.py`

- `ShellExecuteInput` 加 `timeout: int|None`（默认走 `DEFAULT_FOREGROUND_TIMEOUT=60`）+ `run_in_background: bool=False`。
- `_arun` 把 timeout（缺省 60）/`allow_background=True`/`run_in_background`/workspace_id/conversation_id/intent 透传 `aexecute`。workspace_id/conversation_id/intent 来源：env `CONVERSATION_ID` + backend 注入的 workspace（见块6），intent 来自工具入参。
- 新增 `create_shell_poll_tool()` / `create_shell_wait_tool()` / `create_shell_kill_tool()`（照 v2 实现，工厂内 import 单例）。**不含** start_service / watch_background。
- 描述强化：一般命令直接 shell_execute 不传 timeout；预判长任务传大 timeout 或 `run_in_background=True`；要结果用 shell_wait 而非空轮询 poll。

#### 块 4：注册工具
文件：`employee.py`、`orchestrator/agent.py`——两处各 append `create_shell_poll_tool()/create_shell_wait_tool()/create_shell_kill_tool()`。

#### 块 5：面板数据 REST 路由
文件：`apps/server/src/api/task_api.py`（或就近 shell 相关 api 文件）

- `GET /workspaces/{workspace_id}/tasks/shell-executions?conversation_id=...` → 调 `registry.list_snapshot(workspace_id, conversation_id)` 返回 `PageResponse`/简单 `{code,data}`。只读内存注册表，不落 DB。

#### 块 6：workspace_events 增事件（面板失效刷新）
文件：`apps/server/src/service/workspace_events.py` + register/finish 处

- 加 `SHELL_TASK_STARTED="shell_task_started"` / `SHELL_TASK_FINISHED="shell_task_finished"`。
- `register()` 成功发 started；poll/wait/sweep 首次发现 finished 时发 finished（带 conversation_id/workspace_id 供前端定向失效）。发事件经 `WorkspaceEventBus.publish(workspace_id, ...)`。
- backend 需知道 workspace_id：经 `SkillAwareShellBackend` 构造注入（仿现有 CONVERSATION_ID 注入路径），供 register 与发事件。

#### 块 7：恢复 read_timeout（独立提交）
文件：`apps/server/src/llm/factory.py`——若仍为 None，恢复 `min(180.0, req_timeout)`（长命令已转后台不再占 LLM 连接）。

#### 块 8：prompt 教交错执行
文件：`orchestrator/prompts.py` + `prompts.py`

- 一段同义指引：短命令直接同步；预判长任务用 `run_in_background=True` 或大 timeout 转后台拿到 session_id 后**同一轮内去做别的**（写脚本/准备下一步），需要结果再 `shell_wait` 有节奏等；真超大任务告诉用户「已在后台，可在后台任务面板查看或稍后问我」并体面收尾；**绝不**因没完成就 kill 重试。

### 前端（镜像 employee-tasks 面板模式）

#### 块 9：可见性 store
`apps/web/src/stores/shell-tasks-panel-store.ts`——仿 `employee-tasks-panel-store.ts`，`{isOpen, open, close, toggle}`，open 时互斥关其它右栏面板。

#### 块 10：数据 hook
`apps/web/src/hooks/use-shell-executions.ts`——TanStack Query 调块5 路由，`staleTime:5_000, refetchInterval:10_000`，按当前 conversation_id enabled。

#### 块 11：面板组件
`apps/web/src/components/chat/panel/shell-tasks-panel.tsx`——仿 `employee-tasks-panel.tsx`：Header（标题+running 计数+关闭）；进行中/已完成两段；每条显示 intent/command、状态、计时（由 started_wall 前端算 elapsed）、退出码；点开行展开看输出（点开时按需 `shell_poll`/读 snapshot 的 new_output，或调一个轻量 detail 端点）。

#### 块 12：入口指示器
`apps/web/src/components/chat/curator/...`（或 chat header）——仿 `running-tasks-indicator`：有 running shell 任务时显示「N 个后台命令」徽标，点击 `useShellTasksPanelStore.toggle()`。

#### 块 13：接入右栏注册表 + SSE 失效
- `chat-layout.tsx`：`RightPanel` 加 `"shell-tasks"`；加 `isShellTasksPanelOpen` 订阅 + 优先级 + 渲染块；`useWorkspaceEvents` 里监听 `shell_task_started/finished` → 失效 `useShellExecutions` 的 queryKey。
- `reset-chat-right-panels.ts` 加 `useShellTasksPanelStore.getState().close()`。

## 不在本期范围
- start_service 常驻服务（用户无需求）。
- 自动唤醒/跨轮重驱动会话（最高风险，用面板替代）。
- claw-code 式命令分级/沙箱（子项目 B，独立）。
- 后台任务跨进程重启持久化（YAGNI，内存注册表）。
- 群会话续跑（无自动唤醒即无关）。

## 数据流

```
直接后台:  shell_execute(cmd, run_in_background=True)
            → 起进程组+tmp 文件 → register(ws,conv,intent) → 立即返回 session_id
            → 发 shell_task_started → 面板出现 Running 条目
            → agent 同一轮去做别的 → 需要时 shell_wait/poll；面板实时计时

超时转后台: shell_execute(cmd, timeout=120)
            → 前台流式等 120s 未完 → 不 kill、register 移交 → 返回 partial+session_id

查看/终止: shell_poll(读增量一眼) / shell_wait(有节奏等一轮) / shell_kill(杀整组)
完成:      poll/wait/sweep 发现退出 → status=finished + 发 shell_task_finished
            → 面板移到 Finished（保留 30 min）→ 用户点开看输出 / 再问 agent
进程退出:  atexit kill_all 杀净所有 running，防孤儿
```

## 风险与缓解
- **孤儿进程（Win）**：进程组起 + killpg/taskkill /T + atexit kill_all。务必三端验证。
- **小时级任务被误杀**：sweep **取消按龄强杀 running**（本期核心 redesign）。
- **临时文件泄漏**：kill/finished 清理 + sweep 兜底 + 1MB→后台改尾部滚动（沿用 v2）。
- **面板 Finished 不显示**：sweep 保留 finished 30 min 再移除。
- **模型空轮询刷屏**：工具描述引导 shell_wait 而非 poll（沿用 v2 经验，不加硬闸）。
- **注册表跨会话共享**：uuid 不可猜；面板按 workspace+conversation 过滤 list_snapshot，隔离够用。
- **aexecute 高频核心路径**：`allow_background=False/run_in_background=False` 必须行为完全不变，加测覆盖原路径。

## 实现补充（落地时新增，spec 同步）

- **sweep 惰性触发**：注册表无后台线程，`poll/wait/list_snapshot` 调用顺带触发 `_maybe_sweep()`（节流 `_SWEEP_INTERVAL=30s`），避免「sweep 写了却没人调」导致 finished 条目/临时文件无限堆积（被排除 v2 的老坑）。
- **日志保留以支持「点开看日志」**：临时输出文件**不再在命令结束时立即删**，改为**条目被移除时**（finished/killed 超 `_FINISHED_RETENTION`）或进程退出 `kill_all` 时才删——保证保留窗内面板可回看日志。
- **面板「点开看日志」**：注册表加只读 `read_output_tail(session_id, max_bytes=64KB)`（取文件尾部、**不动** agent 的 read_offset）；REST `GET /workspaces/{id}/tasks/shell-executions/{session_id}/output` 暴露；前端展开行时拉取、running 时每 3s 刷新。

## 测试（后端 pytest + 前端 tsc/vitest）
- 注册表：register→poll 增量正确；wait 完成/超时+硬顶；kill 杀组+killed；**sweep 不杀 running、保留 finished、超窗移除**；list_snapshot 按 ws/conv 过滤+倒序+elapsed；kill_all。
- aexecute：超时转后台返回 session_id、进程未被杀（poll 查到 running）、register 带 ws/conv/intent；`run_in_background=True` 立即返回不等；`allow_background=False` 维持 kill+124。
- 工具层：timeout/run_in_background schema；poll/wait/kill 调通注册表。
- REST：shell-executions 返回快照、按 conversation 过滤。
- events：register/finish 发 shell_task_started/finished。
- read_timeout：断言 180。
- 前端：tsc 通过；面板 store/hook/component 基本渲染（vitest，仿 running-tasks-indicator.test）。
- 手动：拉镜像 run_in_background → 面板 Running 计时 → agent 交错写脚本 → 完成进 Finished 可点开；普通命令秒回不进面板。
