# 后台命令机制补全 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补全后台命令的「长任务唤醒续跑(hermes 式 per-process watcher)+ 手动 kill 端点 + 工作台面板入口 + 轻量指示器」四块缺口。

**Architecture:** 续跑采用 hermes-agent 蓝本：每个后台命令转后台时起一个 per-process asyncio watcher 任务，轮询注册表，进程退出即注入合成消息触发 `build_employee_agent_for_wake` 续跑；`consumed_by_agent` 标志去重防 agent 已主动 poll 后的重复注入。kill 复用已完整的 `registry.kill`(taskkill /T 整树)+ 新增 DELETE 端点。前端补 kill 按钮、工作台挂面板、指示器改 inline 超链接。

**Tech Stack:** Python FastAPI + asyncio + apscheduler(不新增)；React 19 + TanStack Query + Zustand。

**前置参考契约（已核实）：**
- `shell_background_registry.py`：`register(*, popen, tmp_path, read_offset, command, workspace_id, conversation_id, intent) -> str(sid)`；`poll(sid, from_offset=None) -> {found, running, exit_code, new_output, offset}`；`kill(sid) -> {found, killed}`；`_Session` 字段含 `popen/command/exit_code/status/conversation_id/workspace_id/finished_emitted`。
- `terminate_process_group(popen)`：已 Windows `taskkill /F /T /PID` 整树杀 + posix `killpg SIGKILL`。
- `build_employee_agent_for_wake(conversation_id)`（`execution.py:459`）：构造续跑 agent，`enable_hitl=False`，**必须在主事件循环线程调用**。
- `skill_shell_backend.aexecute`：转后台在 `_background_handoff.is_set()` 分支（`skill_shell_backend.py:610` 附近），上下文持有 `loop`。
- task_api 端点风格：`/workspaces/{workspace_id}/tasks/shell-executions`（GET list）、`.../{session_id}/output`（GET）。
- 前端 hook `use-shell-executions.ts`：`ShellExecution{session_id,command,intent,status,running,exit_code,started_wall,elapsed_seconds}`；面板 `shell-tasks-panel.tsx` 在 `exec.running` 处渲染项。

---

## 模块 ②：手动 kill（后端端点 + 前端按钮）— 先做，最独立

### Task 1: kill REST 端点

**Files:**
- Modify: `apps/server/src/api/task_api.py`（在 `get_shell_execution_output` 之后插入）
- Test: `apps/server/tests/test_shell_background_registry.py`（追加端点测试，复用现有文件）

- [ ] **Step 1: 写失败测试**

在 `apps/server/tests/test_shell_background_registry.py` 末尾追加：

```python
def test_kill_endpoint_calls_registry_kill(monkeypatch):
    """DELETE shell-executions/{sid} 调 registry.kill 并返回 killed。"""
    from fastapi.testclient import TestClient
    from src.server import app
    from src.service import shell_background_registry as reg_mod

    called = {}

    class _FakeReg:
        def kill(self, sid):
            called["sid"] = sid
            return {"found": True, "killed": True}

    monkeypatch.setattr(
        reg_mod, "get_background_shell_registry", lambda: _FakeReg()
    )
    client = TestClient(app)
    resp = client.delete("/workspaces/1/tasks/shell-executions/abc123")
    assert resp.status_code == 200
    assert resp.json()["data"]["killed"] is True
    assert called["sid"] == "abc123"
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd apps/server && uv run pytest tests/test_shell_background_registry.py::test_kill_endpoint_calls_registry_kill -v`
Expected: FAIL（404 或路由不存在）

- [ ] **Step 3: 实现端点**

在 `apps/server/src/api/task_api.py` 的 `get_shell_execution_output` 函数后插入：

```python
@router.delete(
    "/workspaces/{workspace_id}/tasks/shell-executions/{session_id}",
    response_model=ResponseBase[dict],
    summary="终止后台 shell 命令（面板「终止」按钮）",
)
def kill_shell_execution(
    workspace_id: int,
    session_id: str,
) -> ResponseBase[dict]:
    """手动终止某后台命令：调注册表 kill（整树杀），状态转 killed，
    日志保留在窗口期供面板查看。"""
    from src.service.shell_background_registry import get_background_shell_registry

    r = get_background_shell_registry().kill(session_id)
    return ResponseBase(data=r)
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd apps/server && uv run pytest tests/test_shell_background_registry.py::test_kill_endpoint_calls_registry_kill -v`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/server/src/api/task_api.py apps/server/tests/test_shell_background_registry.py
git commit -m "feat(shell): 后台命令 kill REST 端点（DELETE shell-executions/{sid}）"
```

### Task 2: 前端 kill mutation hook

**Files:**
- Create: `apps/web/src/hooks/use-kill-shell-execution.ts`
- Test: 无（薄 mutation，由 Task 3 集成验证）

- [ ] **Step 1: 写 hook**

创建 `apps/web/src/hooks/use-kill-shell-execution.ts`：

```typescript
import { useMutation, useQueryClient } from "@tanstack/react-query"

import { chatKeys } from "@/lib/query-keys/chat"
import { request } from "@/lib/request"
import { getActiveWorkspaceId } from "@/lib/workspace-id"

/** 终止后台 shell 命令。成功后失效该会话的 shell-executions 查询以刷新面板。 */
export function useKillShellExecution(
  conversationId: string | number | null | undefined
) {
  const queryClient = useQueryClient()
  const id = conversationId != null ? String(conversationId) : "none"
  return useMutation({
    mutationFn: async (sessionId: string) => {
      const res = await request<{ code: number; data: { killed: boolean } }>(
        `/workspaces/${getActiveWorkspaceId()}/tasks/shell-executions/${sessionId}`,
        { method: "DELETE" }
      )
      return res.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: chatKeys.shellExecutions(id),
      })
    },
  })
}
```

- [ ] **Step 2: 类型检查**

Run: `pnpm typecheck --filter=web`
Expected: PASS（无新类型错误）

- [ ] **Step 3: 提交**

```bash
git add apps/web/src/hooks/use-kill-shell-execution.ts
git commit -m "feat(shell): 前端 kill 后台命令 mutation hook"
```

### Task 3: 面板「终止」按钮

**Files:**
- Modify: `apps/web/src/components/chat/panel/shell-tasks-panel.tsx`（running 项渲染处，约 `:128-167`）
- Test: `apps/web/src/components/chat/panel/shell-tasks-panel.test.tsx`（新建或追加）

- [ ] **Step 1: 写失败测试**

创建/追加 `apps/web/src/components/chat/panel/shell-tasks-panel.test.tsx`，断言 running 项渲染出「终止」按钮、点击调 mutation。先读现有面板组件确认导出名与 props（`ShellTasksPanel`），按其 props 写最小渲染测试：

```typescript
import { describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"

import { ShellTasksRow } from "./shell-tasks-panel"

const mutate = vi.fn()
vi.mock("@/hooks/use-kill-shell-execution", () => ({
  useKillShellExecution: () => ({ mutate, isPending: false }),
}))

describe("ShellTasksRow", () => {
  it("running 项渲染终止按钮并在点击时调用 kill", () => {
    const exec = {
      session_id: "s1",
      command: "sleep 999",
      intent: null,
      status: "running" as const,
      running: true,
      exit_code: null,
      started_wall: Date.now() / 1000,
      elapsed_seconds: 3,
    }
    render(<ShellTasksRow exec={exec} conversationId="42" />)
    const btn = screen.getByRole("button", { name: /终止/ })
    fireEvent.click(btn)
    expect(mutate).toHaveBeenCalledWith("s1")
  })
})
```

> 注：若现有面板把行渲染内联在 `ShellTasksPanel` 里，先抽出一个具名导出 `ShellTasksRow({ exec, conversationId })` 再测（保持现有视觉/逻辑不变，仅抽函数）。

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd apps/web && pnpm vitest run src/components/chat/panel/shell-tasks-panel.test.tsx`
Expected: FAIL（无 ShellTasksRow 导出 / 无终止按钮）

- [ ] **Step 3: 抽出 ShellTasksRow 并加终止按钮**

读 `shell-tasks-panel.tsx`，把单行渲染抽成具名导出 `ShellTasksRow({ exec, conversationId })`，并在 `exec.running` 时于行内加按钮：

```tsx
import { useKillShellExecution } from "@/hooks/use-kill-shell-execution"
// ... 组件内：
const killExec = useKillShellExecution(conversationId)
// ... 在 running 项的右侧操作区渲染：
{exec.running ? (
  <button
    type="button"
    onClick={(e) => {
      e.stopPropagation()
      killExec.mutate(exec.session_id)
    }}
    disabled={killExec.isPending}
    className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
  >
    终止
  </button>
) : null}
```

`ShellTasksPanel` 改为 `executions.map((exec) => <ShellTasksRow key={exec.session_id} exec={exec} conversationId={conversationId} />)`；`conversationId` 由 panel props 透传（确认 panel 已接收，否则在 panel props 加 `conversationId`）。

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd apps/web && pnpm vitest run src/components/chat/panel/shell-tasks-panel.test.tsx`
Expected: PASS

- [ ] **Step 5: 类型检查 + 提交**

```bash
pnpm typecheck --filter=web
git add apps/web/src/components/chat/panel/shell-tasks-panel.tsx apps/web/src/components/chat/panel/shell-tasks-panel.test.tsx
git commit -m "feat(shell): 后台命令面板 running 项加终止按钮"
```

---

## 模块 ④：轻量指示器

### Task 4: 指示器改 inline 超链接

**Files:**
- Modify: `apps/web/src/components/chat/curator/shell-tasks-indicator.tsx`
- Test: `apps/web/src/components/chat/curator/shell-tasks-indicator.test.tsx`（已存在，6 例 — 追加/调整）

- [ ] **Step 1: 写/调整测试**

读现有 `shell-tasks-indicator.test.tsx`，追加一条断言「count>0 时渲染含『N 个后台命令』文案的超链接 button、文案不再是居中 pill」。最小新增：

```typescript
it("count>0 渲染 inline 超链接文案", () => {
  // mock useShellExecutions 返回 2 个 running（沿用文件现有 mock 方式）
  render(<ShellTasksIndicator conversationId="1" />)
  const link = screen.getByRole("button")
  expect(link).toHaveTextContent("2 个后台命令")
  // 轻量：不再是居中 pill（不含 mx-auto rounded-full）
  expect(link.className).not.toContain("rounded-full")
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd apps/web && pnpm vitest run src/components/chat/curator/shell-tasks-indicator.test.tsx`
Expected: FAIL（仍是 rounded-full pill）

- [ ] **Step 3: 改为 inline 超链接**

替换 `shell-tasks-indicator.tsx` 的 return（保留 count 计算与 `count===0` 返回 null、保留 onClick 逻辑）：

```tsx
  return (
    <div className={cn("text-center", className)}>
      <button
        type="button"
        onClick={() => {
          if (onOpenShellTasks) {
            onOpenShellTasks()
            return
          }
          useShellTasksPanelStore.getState().toggle()
        }}
        className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
      >
        <IconTerminal2 className="size-3 shrink-0 animate-pulse" />
        <span>{count} 个后台命令运行中 · 查看</span>
      </button>
    </div>
  )
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd apps/web && pnpm vitest run src/components/chat/curator/shell-tasks-indicator.test.tsx`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/components/chat/curator/shell-tasks-indicator.tsx apps/web/src/components/chat/curator/shell-tasks-indicator.test.tsx
git commit -m "feat(shell): 后台命令指示器改 inline 超链接（替换居中 pill）"
```

---

## 模块 ③：工作台打开后台面板

### Task 5: 工作台挂后台面板 + 接通 onOpenShellTasks

**Files:**
- Modify: `apps/web/src/components/workbench/workbench-content-split.tsx`
- 参考：`apps/web/src/components/chat/shell/chat-layout.tsx:435-440`（ShellTasksPanel 挂载范式）、`apps/web/src/stores/shell-tasks-panel-store.ts`

- [ ] **Step 1: 读现有挂载范式**

读 `chat-layout.tsx:219-220,435-440` 看 `useShellTasksPanelStore`(`isOpen/open/close`) 如何驱动右栏渲染 `ShellTasksPanel`；读 `workbench-content-split.tsx` 的右栏(`resourcesOpen` 那套)结构。

- [ ] **Step 2: 在工作台右栏加 shell-tasks 视图**

在 `workbench-content-split.tsx`：
1. import：`import { ShellTasksPanel } from "@/components/chat/panel/shell-tasks-panel"` 与 `import { useShellTasksPanelStore } from "@/stores/shell-tasks-panel-store"`。
2. 取 store：`const shellTasksOpen = useShellTasksPanelStore((s) => s.isOpen)`、`const closeShellTasks = useShellTasksPanelStore((s) => s.close)`。
3. 在右栏 panel 区（与资源面板同级），当 `shellTasksOpen` 时渲染：

```tsx
{shellTasksOpen ? (
  <ShellTasksPanel
    conversationId={workbenchCuratorConversationId}
    onClose={closeShellTasks}
  />
) : null}
```

4. `CuratorView` 的 `onOpenResourceFile`/相关 props 不动；新增把后台面板打开接到 `CuratorView` 的 `onOpenShellTasks`（若 `CuratorView` 暴露该 prop，则传 `() => useShellTasksPanelStore.getState().open()`；否则 indicator 默认 `toggle()` 已可用，本步只需保证右栏会渲染面板）。

- [ ] **Step 3: 类型检查**

Run: `pnpm typecheck --filter=web`
Expected: PASS

- [ ] **Step 4: 手动验证（启动 web）**

Run: `pnpm dev`，进工作台 → 总管/助手对话有后台命令时点指示器「查看」→ 右栏弹出后台命令面板。
Expected: 面板在工作台右栏可见、可关闭。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/components/workbench/workbench-content-split.tsx
git commit -m "feat(shell): 工作台总管/助手对话挂后台命令面板入口"
```

---

## 模块 ①：长任务唤醒续跑（hermes 式 per-process watcher）— 核心，最后做

### Task 6: 注册表加 `consumed_by_agent` 去重标志

**Files:**
- Modify: `apps/server/src/service/shell_background_registry.py`（`_Session` + `poll`/`wait` + 新方法）
- Test: `apps/server/tests/test_shell_background_registry.py`

- [ ] **Step 1: 写失败测试**

```python
def test_consumed_by_agent_flag():
    """agent 主动 poll/wait 后 is_consumed_by_agent 为真，用于续跑去重。"""
    from src.service.shell_background_registry import BackgroundShellRegistry
    import subprocess, sys, tempfile, os

    reg = BackgroundShellRegistry()
    tf = tempfile.NamedTemporaryFile(delete=False, suffix=".log")
    tf.close()
    p = subprocess.Popen([sys.executable, "-c", "print('hi')"], stdout=open(tf.name, "w"))
    sid = reg.register(popen=p, tmp_path=tf.name, read_offset=0, command="x", conversation_id=7)
    assert reg.is_consumed_by_agent(sid) is False
    reg.poll(sid, agent_initiated=True)
    assert reg.is_consumed_by_agent(sid) is True
    os.unlink(tf.name)
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd apps/server && uv run pytest tests/test_shell_background_registry.py::test_consumed_by_agent_flag -v`
Expected: FAIL（无 is_consumed_by_agent / poll 无 agent_initiated）

- [ ] **Step 3: 实现**

`_Session` 加字段：`consumed_by_agent: bool = False`。
`poll` 与 `wait` 签名加 `agent_initiated: bool = False`，在方法体内若 `agent_initiated` 则置 `s.consumed_by_agent = True`（在 `_lock` 内）。注意：**watcher 调 poll 时传 `agent_initiated=False`（默认）**，agent 工具调 poll/wait 时传 `True`。新增方法：

```python
def is_consumed_by_agent(self, session_id: str) -> bool:
    with self._lock:
        s = self._sessions.get(session_id)
        return bool(s and s.consumed_by_agent)
```

并在 `shell_poll`/`shell_wait` 工具（`shell_execute_tool.py`）调用注册表处补 `agent_initiated=True`（读该文件确认调用点）。

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd apps/server && uv run pytest tests/test_shell_background_registry.py::test_consumed_by_agent_flag -v`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/server/src/service/shell_background_registry.py apps/server/src/service/shell_execute_tool.py apps/server/tests/test_shell_background_registry.py
git commit -m "feat(shell): 注册表加 consumed_by_agent 去重标志（agent 主动 poll/wait 置位）"
```

### Task 7: 续跑注入函数 `wake_conversation_for_finished_command`

**Files:**
- Create: `apps/server/src/service/agent/orchestrator/background_wake.py`
- Test: `apps/server/tests/test_background_wake.py`

- [ ] **Step 1: 写失败测试**

```python
def test_build_wake_message_small_output():
    """小输出注入完整摘要（含 exit code、command、末尾输出）。"""
    from src.service.agent.orchestrator.background_wake import build_wake_message

    msg = build_wake_message(
        session_id="s1", command="make build", exit_code=0,
        output="line1\nline2\n", output_size=12,
    )
    assert "s1" in msg and "exit" in msg.lower() and "make build" in msg
    assert "line2" in msg


def test_build_wake_message_large_output_signal_only():
    """超阈值只发完成信号 + 提示 shell_poll，不内联全部输出。"""
    from src.service.agent.orchestrator.background_wake import build_wake_message

    big = "x" * (200 * 1024)
    msg = build_wake_message(
        session_id="s2", command="big", exit_code=0,
        output=big, output_size=len(big),
    )
    assert "shell_poll" in msg
    assert big not in msg  # 不内联超大输出
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd apps/server && uv run pytest tests/test_background_wake.py -v`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 build_wake_message + wake 触发器**

创建 `apps/server/src/service/agent/orchestrator/background_wake.py`：

```python
"""后台命令完成后唤醒会话续跑（hermes 式 per-process watcher 的注入端）。

watcher 检测到后台命令退出后调用本模块：构造合成消息（小输出内联摘要，
超大输出只发完成信号让 agent 自行 shell_poll），并经 build_employee_agent_for_wake
在主事件循环线程触发新一轮 astream。
"""
from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

# 输出阈值：对齐注册表 _MAX_POLL_BYTES（64KB）。
_INLINE_OUTPUT_LIMIT = 64 * 1024
# 内联摘要的输出 tail 上限（按行边界切，抄 hermes #23284）。
_TAIL_CHARS = 2000


def _tail_on_line_boundary(text: str, limit: int = _TAIL_CHARS) -> str:
    if len(text) <= limit:
        return text
    tail = text[-limit:]
    nl = tail.find("\n")
    snapped = tail[nl + 1 :] if nl != -1 else tail
    return f"[… 输出已截断，仅显示末尾 {len(snapped)} 字符]\n{snapped}"


def build_wake_message(
    *, session_id: str, command: str, exit_code: int | None, output: str, output_size: int
) -> str:
    """构造续跑合成消息。小输出内联摘要；超阈值只发信号。"""
    head = (
        f"[系统通知] 后台命令 {session_id} 已结束（exit={exit_code}）。\n"
        f"命令：{command}\n"
    )
    if output_size > _INLINE_OUTPUT_LIMIT:
        return (
            head
            + f"输出较大（{output_size} 字节），未内联。请用 shell_poll({session_id!r}) "
            "拉取完整输出后继续。"
        )
    return head + f"输出：\n{_tail_on_line_boundary(output)}"
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd apps/server && uv run pytest tests/test_background_wake.py -v`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/server/src/service/agent/orchestrator/background_wake.py apps/server/tests/test_background_wake.py
git commit -m "feat(shell): 续跑合成消息构造（小输出内联/超大发信号）"
```

### Task 8: per-process watcher（轮询注册表 → 退出注入续跑）

**Files:**
- Modify: `apps/server/src/service/agent/orchestrator/background_wake.py`（加 watcher 协程 + 续跑触发）
- Modify: `apps/server/src/service/skill_shell_backend.py`（移交后台处起 watcher）
- Test: `apps/server/tests/test_background_wake.py`

- [ ] **Step 1: 写失败测试（watcher 退出后调注入，已消费则跳过）**

```python
import asyncio


def test_watcher_injects_on_exit_and_dedupes(monkeypatch):
    """watcher 检测退出 → 调 wake；若 is_consumed_by_agent 为真则跳过注入。"""
    from src.service.agent.orchestrator import background_wake as bw

    polls = [
        {"found": True, "running": True, "exit_code": None, "new_output": ""},
        {"found": True, "running": False, "exit_code": 0, "new_output": "done\n"},
    ]
    consumed = {"v": False}
    injected = {"called": False}

    class _Reg:
        def poll(self, sid, from_offset=None, agent_initiated=False):
            return polls.pop(0) if polls else {"found": True, "running": False, "exit_code": 0, "new_output": ""}
        def is_consumed_by_agent(self, sid):
            return consumed["v"]
        def read_output_tail(self, sid, max_bytes=65536):
            return {"output": "done\n", "size": 5}

    monkeypatch.setattr(bw, "get_background_shell_registry", lambda: _Reg())
    monkeypatch.setattr(bw, "_inject_wake", lambda **k: injected.__setitem__("called", True))

    asyncio.run(bw.watch_background_command(
        session_id="s1", conversation_id=7, command="make", poll_interval=0.01
    ))
    assert injected["called"] is True

    # 已被 agent 消费 → 不注入
    injected["called"] = False
    consumed["v"] = True
    polls[:] = [{"found": True, "running": False, "exit_code": 0, "new_output": ""}]
    asyncio.run(bw.watch_background_command(
        session_id="s1", conversation_id=7, command="make", poll_interval=0.01
    ))
    assert injected["called"] is False
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd apps/server && uv run pytest tests/test_background_wake.py::test_watcher_injects_on_exit_and_dedupes -v`
Expected: FAIL（无 watch_background_command / _inject_wake）

- [ ] **Step 3: 实现 watcher + 注入**

在 `background_wake.py` 追加：

```python
import asyncio

from src.service.shell_background_registry import get_background_shell_registry

_DEFAULT_POLL_INTERVAL = 2.0  # 运行中轮询间隔（秒）
_MAX_POLL_INTERVAL = 10.0     # 退避上限


def _inject_wake(*, conversation_id: int, message: str) -> None:
    """主事件循环线程内：构造续跑 agent 并触发一轮 astream。

    复用 execution.build_employee_agent_for_wake。若会话有进行中 turn（is_active），
    跳过本次注入（避免打断；watcher 已退出，由后续手动/重发触发——本期不重试）。
    """
    from src.service.agent.orchestrator.execution import build_employee_agent_for_wake
    from src.service.stream_registry import get_stream_registry

    reg = get_stream_registry()
    if reg.is_active(conversation_id):
        logger.info("[bg-wake] conv=%s 有进行中 turn，跳过注入", conversation_id)
        return
    try:
        agent = build_employee_agent_for_wake(conversation_id)
    except Exception:
        logger.warning("[bg-wake] 构造续跑 agent 失败 conv=%s", conversation_id, exc_info=True)
        return
    # 触发续跑一轮（沿用员工流启动入口；具体 astream 启动函数读 execution.py 确认）。
    reg.start_wake_turn(conversation_id, agent, message)


async def watch_background_command(
    *, session_id: str, conversation_id: int | None, command: str,
    poll_interval: float = _DEFAULT_POLL_INTERVAL,
) -> None:
    """per-process watcher：轮询注册表至命令退出，退出后注入续跑。

    无 conversation_id（裸 shell）→ 静默等退出、不注入。
    """
    reg = get_background_shell_registry()
    interval = poll_interval
    while True:
        await asyncio.sleep(interval)
        r = reg.poll(session_id, agent_initiated=False)
        if not r.get("found"):
            return
        if not r.get("running"):
            break
        interval = min(interval * 1.5, _MAX_POLL_INTERVAL)

    if conversation_id is None:
        return
    if reg.is_consumed_by_agent(session_id):
        logger.info("[bg-wake] sid=%s 已被 agent 消费，跳过注入", session_id)
        return

    tail = reg.read_output_tail(session_id)
    output = tail.get("output", "") if isinstance(tail, dict) else ""
    output_size = tail.get("size", len(output)) if isinstance(tail, dict) else len(output)
    exit_code = r.get("exit_code")
    message = build_wake_message(
        session_id=session_id, command=command, exit_code=exit_code,
        output=output, output_size=output_size,
    )
    _inject_wake(conversation_id=conversation_id, message=message)
```

> 注：`reg.start_wake_turn` 与 `reg.is_active` 是 stream_registry 的对接点 —— Step 3a 落实。

- [ ] **Step 3a: stream_registry 对接（is_active / start_wake_turn）**

读 `apps/server/src/service/stream_registry.py`，确认/补：
- `is_active(conversation_id) -> bool`：是否有进行中 turn（很可能已有 `is_active`/`request_start` 同义判断，复用）。
- `start_wake_turn(conversation_id, agent, message)`：以合成 user 消息启动一轮员工 astream。**优先复用现有员工流启动入口**（如 `execution.py` 里 `_schedule_employee_stream` / `start_task_as_conversation` 的续跑路径），把 `message` 作为输入。若无直接可复用入口，封装一个最薄的：落一条 user 消息 + 触发 astream。本步以读代码后选定的真实函数名为准，替换 `_inject_wake` 内调用。

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd apps/server && uv run pytest tests/test_background_wake.py -v`
Expected: PASS（watcher 注入 + 去重两例）

- [ ] **Step 5: 在转后台处起 watcher**

`skill_shell_backend.py` 移交后台分支（`_background_handoff` set 后、`register` 拿到 sid 处），用持有的 `loop` 起 watcher：

```python
# 转后台后起 per-process watcher 续跑（仅当有归属会话；裸 shell 也起但静默）
from src.service.agent.orchestrator.background_wake import watch_background_command
loop.call_soon_threadsafe(
    lambda: asyncio.ensure_future(
        watch_background_command(
            session_id=sid, conversation_id=conversation_id, command=command,
        )
    )
)
```

> `sid`/`conversation_id`/`command` 取自该上下文（register 的入参与返回）。读 `skill_shell_backend.py:595-630` 确认变量名。

- [ ] **Step 6: 回归 + 提交**

Run: `cd apps/server && uv run pytest tests/test_background_wake.py tests/test_shell_background_registry.py -v`
Expected: 全 PASS

```bash
git add apps/server/src/service/agent/orchestrator/background_wake.py apps/server/src/service/skill_shell_backend.py apps/server/tests/test_background_wake.py
git commit -m "feat(shell): per-process watcher 唤醒续跑（退出注入+is_active不打断+去重）"
```

### Task 9: 全量回归 + tsc

- [ ] **Step 1: 后端测试**

Run: `cd apps/server && uv run pytest tests/test_shell_background_registry.py tests/test_background_wake.py -v`
Expected: 全 PASS

- [ ] **Step 2: 前端测试 + 类型**

Run: `cd apps/web && pnpm vitest run src/components/chat/panel/shell-tasks-panel.test.tsx src/components/chat/curator/shell-tasks-indicator.test.tsx && pnpm typecheck`
Expected: 全 PASS

- [ ] **Step 3: 提交（若有 lint/format 调整）**

```bash
pnpm format
git add -A && git commit -m "chore(shell): 后台命令机制补全——回归与格式化" || echo "无改动"
```

---

## Self-Review 结果

- **Spec 覆盖**：①Task6-8、②Task1-3、③Task5、④Task4 全覆盖。watcher 不打断进行中 turn（Task8 `is_active`）、去重（Task6+8）、大小输出分支（Task7）、裸 shell 静默（Task8）、kill 整树（Task1 复用已验证 `terminate_process_group`）均落任务。
- **Placeholder**：Step 3a 与 Task8 Step5 标注「读代码确认真实函数名」属必要的代码定位，非占位——已给出候选函数名与定位行号。
- **类型一致**：`is_consumed_by_agent`/`consumed_by_agent`/`agent_initiated`/`watch_background_command`/`build_wake_message`/`_inject_wake`/`start_wake_turn` 全程一致。`ShellTasksRow`(Task3) 在 Task5 透传 `conversationId` 一致。
- **风险点**：`start_wake_turn`/`is_active` 须以 stream_registry 真实 API 为准（Task8 Step3a 显式要求读代码对接）——这是唯一需实现时核对的接缝。
