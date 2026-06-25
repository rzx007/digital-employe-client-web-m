# 后台命令机制补全：唤醒续跑 + kill + 面板入口 + 轻量指示器

> 日期：2026-06-25
> 前序：`2026-06-25-shell-restrained-exec-engine-design.md`（v1，已落地 commit `9819b50e`）
> 本文为 v2：补全 v1 刻意砍掉的「唤醒续跑」及若干半成品。

## 背景

v1 落地了「克制版」后台命令引擎（超时转后台、`run_in_background`、`shell_poll/wait/kill` 工具、注册表 `shell_background_registry`、后台命令面板），但**有意排除了被判高风险的 v2 自动唤醒/续跑**，并留下几处半成品：

- 续跑 agent 构造器 `build_employee_agent_for_wake(conversation_id)` 已存在（`execution.py:459`），但**触发链路被砍**，`_default_wake_fn` 仅在注释里出现、无定义。
- 注册表 `registry.kill(sid)` 方法存在，但**未暴露 REST 端点**，前端无 kill 按钮。
- 工作台总管/助手对话用 `CuratorView`(compact)，`ShellTasksIndicator` 的 `onOpenShellTasks` 未接通。
- 指示器是居中圆角 button，占独立一行，偏重。

## 参考蓝本

横向调研三个项目的后台命令机制：

| 能力 | claw-code | **hermes-agent** | 本项目 dev-wl |
|---|---|---|---|
| 后台注册表 | ❌ 裸 PID 丢输出 | ✅ `ProcessRegistry` | ✅ `shell_background_registry` |
| kill 后台命令 | ❌ | ✅ `taskkill /PID <pid> /T /F` 整树+论证 | ⚠️ 后端有方法未暴露 |
| 完成续跑/唤醒 | ❌ fire-and-forget | ✅ **per-process watcher + 注入合成消息** | ⚠️ 有续跑构造器、链路未接 |
| 去重防重触发 | — | ✅ `is_completion_consumed` | 待做 |

**结论**：claw-code 不做续跑（spawn 即 detach、`Stdio::null()`），仅状态语义可借鉴；**hermes-agent 是主蓝本** —— 其 `tools/process_registry.py` + `gateway/run.py::_run_process_watcher` 给出了完整的「per-process 常驻 watcher 轮询 → 进程退出即注入合成消息触发新一轮 agent → `is_completion_consumed` 去重」设计。

## 四个子模块

### ① 长任务唤醒续跑（hermes 式 per-process watcher，核心）

**关键问题**：「每轮 agent turn 结束 drain」无法唤醒**空闲会话** —— 大任务转后台后本轮即结束、无下一轮 turn。必须有**不依赖 turn 的常驻触发器**。采用 hermes 式：**每个后台命令一个 per-process watcher 任务**。

**触发链路**：

1. `skill_shell_backend.aexecute` 在「移交注册表」那一刻（`_background_handoff.is_set()` 分支，该上下文持有主循环 `loop`），经 `loop.call_soon_threadsafe` 起一个 `asyncio.create_task` 的 per-process watcher。
2. watcher 循环：`while True: await asyncio.sleep(interval)` → `registry.poll(sid)` 取状态 → 进程 `exited` 即跳出。**watcher 不自己 wait 进程**，只读注册表（注册表 `_settle_if_exited` 已检测退出），避免重复 wait 竞态。
3. 进程退出后注入续跑：
   - **去重闸** `is_completion_consumed(sid)`：agent 若已主动 `shell_poll/wait/log` 消费过该命令结果 → 跳过自动续跑（防重复触发）。
   - **喂给 agent 的内容（可配置，默认按输出大小自适应）**：
     - 输出 ≤ 阈值（默认 64KB，对齐 `_MAX_POLL_BYTES`）→ 注入完成摘要：`[后台命令 {sid} 完成 exit={code}\nCommand: {cmd}\nOutput（末尾，按行边界切，≤2000字符）:\n{tail}]`。
     - 输出 > 阈值 → 只发完成信号 + 提示 agent 自行 `shell_poll` 拉取。
   - 经 `build_employee_agent_for_wake(conversation_id)` 构造续跑 agent（`enable_hitl=False`），`call_soon_threadsafe` 搬主循环触发新一轮。

**watcher 携带元数据**：`session_id` / `conversation_id` / `workspace_id`（注册表 `register()` 已记录），用于续跑路由。无 `conversation_id` 的命令（裸 shell）→ watcher 静默等退出、不注入。

**轮询间隔**：默认 2s（运行中），可随运行时长退避（参照 hermes 自适应）。

**竞态/生命周期**：
- watcher 自管生命周期：进程退出 / 被 kill / 注册表条目消失 → watcher 自删。
- 注入只在主循环线程（复用 `build_employee_agent_for_wake` 的「主事件循环线程」契约）。
- 续跑触发时若会话已有进行中 turn（is_active）→ 推迟到空闲（不打断进行中 turn）。

**不做（YAGNI）**：apscheduler 全局兜底扫描、watch_patterns 提前唤醒、群会话自动续跑（本期仍拒绝群续跑）、claw-code 会话状态机。

### ② 后台命令手动 kill

- **后端**：`task_api.py` 新增 `DELETE /workspaces/{workspace_id}/tasks/shell-executions/{session_id}` → 调已有 `registry.kill(session_id)`。返回 killed 状态。
- **kill 实现核对**：确认 Windows 路径走 `taskkill /PID <pid> /T /F`（整树杀，参照 hermes 论证：`psutil.terminate()` 只杀目标 handle 不杀子孙）；现有 `terminate_process_group` 应已具备，核对 `/T`。
- **前端**：`shell-tasks-panel.tsx` 每个 `running` 项加「终止」按钮 → 调新端点 → SSE 失效 / query 失效刷新。kill 后状态转 `killed`。

### ③ 工作台总管/助手对话打开后台面板

- 现状：工作台 `workbench-content-split.tsx` 用 `CuratorView`(compact)，`ShellTasksIndicator` 的 `onOpenShellTasks` 未传 → 点击只 `toggle()` 一个工作台右栏未挂载的面板。
- 修：把 `ShellTasksPanel` 挂进工作台右栏（复用现有 `ShellTasksPanel` + `useShellTasksPanelStore`），把 `onOpenShellTasks` 接到打开右栏 shell-tasks 视图。

### ④ 轻量指示器（替换长条）

- 现状：`shell-tasks-indicator.tsx` 是居中圆角 button「N 个后台命令」，占独立一行。
- 改：正文下方 inline 小字 + 超链接式触发，例：`⌁ N 个后台命令运行中 · 查看`。点击打开面板。`count === 0` 返回 null 不变。

## 测试

**后端**：
- watcher 注入续跑：转后台 → 进程退出 → watcher 检测 → 注入续跑（mock `build_employee_agent_for_wake`）。
- `is_completion_consumed` 去重：agent 已 poll → watcher 不注入。
- 大/小输出分支：≤64KB 注入摘要、>64KB 只发信号。
- kill 端点：DELETE → registry.kill 被调、状态转 killed、整树杀（mock）。
- 无 conversation_id 的命令：watcher 静默不注入。

**前端**：
- kill 按钮：点击调 DELETE 端点 + 刷新。
- 轻量指示器：count>0 渲染超链接、count=0 渲染 null。
- 工作台面板：`onOpenShellTasks` 打开右栏 shell-tasks。

## 不做（YAGNI）

apscheduler 定时兜底、watch_patterns、群会话自动续跑、claw-code 会话状态机。
