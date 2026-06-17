# 执行卡片「工具足迹」Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 执行卡片加一个默认折叠的「🔧 工具足迹」,点开懒加载该执行所属员工会话的工具调用列表(从已存的 message_parts 提取),复用现成 ToolGroupBlock 渲染——消息流内嵌的 Claude-Code 式事后展示。

**Architecture:** 后端新增只读端点据 `log.conversation_id` 抽出该会话 assistant 消息 message_parts 里 `type` 以 `"tool-"` 开头的 part;前端卡片折叠区点开懒加载(TanStack Query `enabled`)→ 合成最小 UIMessage 壳过现成 `classifyMessageParts` → `ToolGroupBlock` 渲染。零碰流式热循环、纯只读。

**Tech Stack:** Python FastAPI + SQLAlchemy(`uv`)、React 19 + TS + TanStack Query。

**关联 spec:** [docs/superpowers/specs/2026-06-17-orchestrator-tool-footprint-design.md](../specs/2026-06-17-orchestrator-tool-footprint-design.md)

**基线(改动后零新增失败):** 后端 `cd apps/server && uv run pytest -q` → 5 failed / 598 passed;前端 typecheck `cd apps/web && npx tsc -p tsconfig.app.json --noEmit` → 90;vitest → 1 failed(基线)。

---

## File Structure

| 文件 | 责任 | 动作 |
|---|---|---|
| `apps/server/src/service/task_service.py` | `get_conversation_tool_parts` + `get_execution_tool_footprint`(404) | Modify |
| `apps/server/src/schemas/task.py` | `ToolFootprintRead` | Modify |
| `apps/server/src/api/task_api.py` | 端点 `GET .../tool-footprint` | Modify |
| `apps/server/tests/test_tool_footprint.py` | helper + 端点服务测试 | Create |
| `apps/web/src/types/schedule-monitor.ts` | `ToolFootprint` 类型 | Modify |
| `apps/web/src/hooks/use-schedule-monitor-queries.ts` | `useToolFootprint`(lazy) | Modify |
| `apps/web/src/components/chat/message-blocks/execution-report-card.tsx` | 折叠足迹区 + classifier→ToolGroupBlock | Modify |

**接地事实(已核实):**
- `ConversationMessage`：`conversation_id`、`role`、`message_parts`(JSON Text，前端可渲染 parts)。工具 part 形如 `{type:"tool-<name>", toolCallId, state, input, output}`。
- task_api 子端点模式：`@router.<m>("/workspaces/{workspace_id}/tasks/executions/{task_execution_log_id}/...", response_model=ResponseBase[...])`，`db: Session = Depends(get_db)`。task_service 已 import `HTTPException, status, select, json`、`WorkspaceService`、`TaskExecutionLog`。
- 前端 hook：`request<{code,data}>(...)` + `useQuery({ enabled, staleTime })`，`WORKSPACE_ID=1`，`chatKeys.all`。card 已有 `useState` 折叠先例(output 的 `expanded`)。
- classifier：`classifyMessageParts(message, opts?)` 吃 `UIMessage` 壳(要 `.parts/.role/.id`)；存储 tool part 即 `ToolUIPart`，合成 `{id, role:"assistant", parts: toolParts, content:""}` 即可。`ToolGroupBlock` 吃 `block:{kind:"tool-group",...}`。

---

## Task 1: 后端足迹端点 + helper

**Files:**
- Modify: `apps/server/src/service/task_service.py`(加两 staticmethod)
- Modify: `apps/server/src/schemas/task.py`(加 `ToolFootprintRead`)
- Modify: `apps/server/src/api/task_api.py`(加端点 + import `ToolFootprintRead`)
- Test: `apps/server/tests/test_tool_footprint.py`(Create)

- [ ] **Step 1: 写失败测试**

```python
# apps/server/tests/test_tool_footprint.py
import json
import pytest
from src.models.workspace import Workspace
from src.models.employee import Employee
from src.models.conversation import Conversation, ConversationMessage
from src.models.task_execution_log import TaskExecutionLog
from src.models.workspace import cst_now
from src.service.task_service import TaskService


def _seed_conv_with_parts(db, parts_per_msg):
    """parts_per_msg: list of (role, parts_list)。返回 (ws, conv)。"""
    ws = Workspace(name="w", root_path="/tmp/w"); db.add(ws); db.flush()
    conv = Conversation(workspace_id=ws.id, target_type="employee", target_id=1, title="t")
    db.add(conv); db.flush()
    for role, parts in parts_per_msg:
        db.add(ConversationMessage(
            conversation_id=conv.id, role=role, content="",
            message_parts=json.dumps(parts) if parts is not None else None,
            stream_state="completed",
        ))
    db.commit()
    return ws, conv


def test_get_conversation_tool_parts_filters_tool_only(db_session):
    parts1 = [{"type": "text", "text": "hi"}, {"type": "tool-web_search", "toolCallId": "a", "state": "output-available"}]
    parts2 = [{"type": "tool-write_file", "toolCallId": "b", "state": "output-available"}]
    ws, conv = _seed_conv_with_parts(db_session, [("assistant", parts1), ("assistant", parts2)])
    out = TaskService.get_conversation_tool_parts(db_session, conv.id)
    assert [p["type"] for p in out] == ["tool-web_search", "tool-write_file"]  # 只 tool-*、顺序保留


def test_get_conversation_tool_parts_empty_cases(db_session):
    assert TaskService.get_conversation_tool_parts(db_session, None) == []
    ws, conv = _seed_conv_with_parts(db_session, [("user", [{"type": "text", "text": "q"}])])
    assert TaskService.get_conversation_tool_parts(db_session, conv.id) == []  # 无 assistant tool


def test_get_execution_tool_footprint_404(db_session):
    from fastapi import HTTPException
    ws = Workspace(name="w", root_path="/tmp/w"); db_session.add(ws); db_session.commit()
    with pytest.raises(HTTPException):
        TaskService.get_execution_tool_footprint(db_session, ws.id, 99999)


def test_get_execution_tool_footprint_returns_parts(db_session):
    parts = [{"type": "tool-read_file", "toolCallId": "c", "state": "output-available"}]
    ws, conv = _seed_conv_with_parts(db_session, [("assistant", parts)])
    emp = Employee(workspace_id=ws.id, name="e", employee_code="c"); db_session.add(emp); db_session.flush()
    log = TaskExecutionLog(
        task_id=1, workspace_id=ws.id, employee_id=emp.id, skill_id=None,
        task_name_snapshot="t", run_status="success", run_result="r",
        input_json="{}", output_json="{}", conversation_id=conv.id,
        started_at=cst_now(),
    )
    db_session.add(log); db_session.commit()
    got = TaskService.get_execution_tool_footprint(db_session, ws.id, log.id)
    assert [p["type"] for p in got] == ["tool-read_file"]
```

- [ ] **Step 2: 跑确认失败**

Run: `cd apps/server && uv run pytest tests/test_tool_footprint.py -v`
Expected: FAIL（方法不存在）

- [ ] **Step 3: 实现 helper + 服务方法**

`task_service.py`（`TaskService` 类内，靠近其它 execution 方法。确认顶部已 import `json`、`select`、`HTTPException`、`status`、`WorkspaceService`、`TaskExecutionLog`）：
```python
    @staticmethod
    def get_conversation_tool_parts(db: Session, conversation_id: int | None) -> list[dict[str, Any]]:
        """取某会话 assistant 消息 message_parts 里 type 以 'tool-' 开头的 part(按消息顺序)。"""
        from src.models.conversation import ConversationMessage

        if conversation_id is None:
            return []
        msgs = list(
            db.scalars(
                select(ConversationMessage)
                .where(
                    ConversationMessage.conversation_id == conversation_id,
                    ConversationMessage.role == "assistant",
                )
                .order_by(ConversationMessage.id.asc())
            ).all()
        )
        out: list[dict[str, Any]] = []
        for m in msgs:
            if not m.message_parts:
                continue
            try:
                parts = json.loads(m.message_parts)
            except (ValueError, TypeError):
                continue
            if not isinstance(parts, list):
                continue
            for p in parts:
                if (
                    isinstance(p, dict)
                    and isinstance(p.get("type"), str)
                    and p["type"].startswith("tool-")
                ):
                    out.append(p)
        return out

    @staticmethod
    def get_execution_tool_footprint(
        db: Session, workspace_id: int, execution_log_id: int
    ) -> list[dict[str, Any]]:
        """据执行日志取其会话级工具足迹(校验 workspace,404 若不存在/跨 workspace)。"""
        WorkspaceService.get_workspace(db, workspace_id)
        log = db.get(TaskExecutionLog, execution_log_id)
        if not log or log.workspace_id != workspace_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="未找到任务执行日志。"
            )
        return TaskService.get_conversation_tool_parts(db, log.conversation_id)
```
（`Any` 已在 task_service 顶部 import；若无则加 `from typing import Any`——核对。）

`schemas/task.py`（加，仿其它 BaseModel）：
```python
class ToolFootprintRead(BaseModel):
    tool_count: int
    parts: list[dict[str, Any]]
```
（`Any` 已 import；核对。）

`api/task_api.py`：import 群加 `ToolFootprintRead`；加端点（仿现有 executions 子端点）：
```python
@router.get(
    "/workspaces/{workspace_id}/tasks/executions/{task_execution_log_id}/tool-footprint",
    response_model=ResponseBase[ToolFootprintRead],
    summary="执行的工具足迹(事后,会话级)",
)
def get_tool_footprint(
    workspace_id: int,
    task_execution_log_id: int,
    db: Session = Depends(get_db),
) -> ResponseBase[ToolFootprintRead]:
    """该执行所属员工会话调用过的工具(从已存 message_parts 提取,只读)。"""
    parts = TaskService.get_execution_tool_footprint(
        db, workspace_id=workspace_id, execution_log_id=task_execution_log_id
    )
    return ResponseBase(data=ToolFootprintRead(tool_count=len(parts), parts=parts))
```

- [ ] **Step 4: 跑确认通过 + 全量**

Run: `cd apps/server && uv run pytest tests/test_tool_footprint.py -v && uv run pytest -q`
Expected: 4 新测试 PASS；全量 5 failed / 602 passed(+4)，零新增。

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/service/task_service.py apps/server/src/schemas/task.py apps/server/src/api/task_api.py apps/server/tests/test_tool_footprint.py
git commit -m "feat(chat): 工具足迹端点(会话级,从 message_parts 提取 tool-* part)"
```

---

## Task 2: 前端类型 + 懒加载 hook

**Files:**
- Modify: `apps/web/src/types/schedule-monitor.ts`(加 `ToolFootprint`)
- Modify: `apps/web/src/hooks/use-schedule-monitor-queries.ts`(加 `useToolFootprint`)

- [ ] **Step 1: 类型**

`schedule-monitor.ts` 加：
```ts
export interface ToolFootprint {
  tool_count: number
  /** 工具 parts(ToolUIPart 形态),交前端 classifier → ToolGroupBlock 渲染 */
  parts: Record<string, unknown>[]
}
```

- [ ] **Step 2: hook(懒加载)**

`use-schedule-monitor-queries.ts` 加（仿 `useCuratorTaskExecutions`，import `ToolFootprint`）：
```ts
/** 执行的工具足迹(事后,会话级)。enabled 受卡片展开态控制——点开才取一次。 */
export function useToolFootprint(
  executionLogId: number | null | undefined,
  opts?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: [...chatKeys.all, "tool-footprint", executionLogId ?? "none"],
    queryFn: async ({ signal }) => {
      const res = await request<{ code: number; data: ToolFootprint }>(
        `/workspaces/${WORKSPACE_ID}/tasks/executions/${executionLogId}/tool-footprint`,
        { signal }
      )
      return res.data
    },
    enabled: (opts?.enabled ?? false) && executionLogId != null,
    staleTime: 60_000,
  })
}
```

- [ ] **Step 3: typecheck**

Run: `cd apps/web && npx tsc -p tsconfig.app.json --noEmit 2>&1 | grep -c "error TS"`
Expected: 90(基线，零新增)

- [ ] **Step 4: format + Commit**

```bash
cd "D:/code/company/digital-employe-client-web-main" && npx prettier --write apps/web/src/types/schedule-monitor.ts apps/web/src/hooks/use-schedule-monitor-queries.ts
git add apps/web/src/types/schedule-monitor.ts apps/web/src/hooks/use-schedule-monitor-queries.ts
git commit -m "feat(chat): useToolFootprint 懒加载 hook + 类型"
```

---

## Task 3: 卡片折叠足迹区(classifier → ToolGroupBlock)

**Files:**
- Modify: `apps/web/src/components/chat/message-blocks/execution-report-card.tsx`

**先读现成渲染面**：`apps/web/src/lib/chat/message-classifier.ts`(`classifyMessageParts` 的确切导出名 + 返回 `ClassifiedBlock[]` + `tool-group` block 形态)、`apps/web/src/components/chat/message-blocks/tool-group-block.tsx`(`ToolGroupBlock` props)。确认 `classifyMessageParts` 入参 `UIMessage` 的确切类型来源(从 ai/@ai-sdk 或本地 types),按真实签名合成壳。

- [ ] **Step 1: 加折叠足迹区**

在 `execution-report-card.tsx`：
1. import：`useToolFootprint`(from hooks)、`classifyMessageParts`(from `@/lib/chat/message-classifier`)、`ToolGroupBlock`(from `./tool-group-block`)、`IconChevronRight`/`IconTool` 之类(从 `@tabler/icons-react`，挑已用风格)。
2. 加状态 + 懒加载：
```tsx
const [footprintOpen, setFootprintOpen] = useState(false)
const { data: footprint, isPending: footprintLoading } = useToolFootprint(
  execution.id,
  { enabled: footprintOpen }
)
```
3. 渲染：仅当 `execution.conversation_id != null`(员工真的跑过)时显示折叠条。放在 full 变体的输出区/底部动作区附近(compact 变体可不加,保持紧凑)：
```tsx
{execution.conversation_id != null && (
  <div>
    <button
      type="button"
      onClick={() => setFootprintOpen((v) => !v)}
      className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
    >
      <IconTool className="size-3" />
      工具足迹
      {footprint ? ` (${footprint.tool_count})` : ""}
      <IconChevronRight className={cn("size-3 transition-transform", footprintOpen && "rotate-90")} />
    </button>
    {footprintOpen && (
      <div className="mt-1">
        {footprintLoading ? (
          <IconLoader2 className="size-3 animate-spin text-muted-foreground" />
        ) : footprint && footprint.tool_count > 0 ? (
          (() => {
            const blocks = classifyMessageParts({
              id: `footprint-${execution.id}`,
              role: "assistant",
              parts: footprint.parts as never,
              content: "",
            } as never)
            return blocks
              .filter((b: { kind: string }) => b.kind === "tool-group")
              .map((b: never, i: number) => <ToolGroupBlock key={i} block={b} />)
          })()
        ) : (
          <p className="text-[11px] text-muted-foreground/70">无工具调用</p>
        )}
      </div>
    )}
  </div>
)}
```
> NOTE：`as never` 是占位——**实现期按 `classifyMessageParts` / `ToolGroupBlock` 的真实类型替换**为正确类型(读 message-classifier.ts 的 `UIMessage`/`ClassifiedBlock` 定义)。若合成壳的类型很别扭,**退路**(spec §3.2):不走 classifier,直接渲染紧凑列表 `footprint.parts.map(p => <div>{String((p as any).type).replace("tool-","")} · {(p as any).state}</div>)`。先尝试主路径(ToolGroupBlock),类型实在拧巴再退紧凑列表。

- [ ] **Step 2: typecheck(基线 90,零新增)**

Run: `cd apps/web && npx tsc -p tsconfig.app.json --noEmit 2>&1 | grep -c "error TS"`
Expected: 90。若 >90,先把新加代码的类型理顺(优先主路径;拧巴则退紧凑列表)。

- [ ] **Step 3: vitest(基线不破)**

Run: `cd apps/web && npx vitest run 2>&1 | grep "Tests "`
Expected: `1 failed | ... passed`(1 failed 为基线 resolve-workbench-curator-panel)

- [ ] **Step 4: format + Commit**

```bash
cd "D:/code/company/digital-employe-client-web-main" && npx prettier --write apps/web/src/components/chat/message-blocks/execution-report-card.tsx
git add apps/web/src/components/chat/message-blocks/execution-report-card.tsx
git commit -m "feat(chat): 执行卡片「工具足迹」折叠区(点开懒加载,ToolGroupBlock 渲染)"
```

- [ ] **Step 5: 人工冒烟(手测,非自动)**

派一个会调工具的任务(如热搜→Word)。完成后在执行卡片点「🔧 工具足迹」→ 确认展开懒加载、显示该员工调用的工具列表(Claude-Code 式行);无工具的任务不显示足迹条或显示"无工具调用";面板轮询不变重。

---

## 风险与注意
- **classifier 真实签名**：Task 3 的 `classifyMessageParts` 入参/返回类型须按 `message-classifier.ts` 真实定义写(plan 里的 `as never` 是占位)。优先主路径(壳→classifier→ToolGroupBlock);类型拧巴则退紧凑列表(spec §3.2)。
- **会话级足迹**：同会话续聊返工含多次尝试工具(spec §3.3 接受)。
- **懒加载**：`enabled: footprintOpen`,点开才取一次、`staleTime` 缓存,不拖累 10s 轮询。
- **基线**：后端 5 failed、前端 typecheck 90 / vitest 1 failed——改后零新增。
- **`Any`/import 核对**：task_service/schemas 顶部若缺 `from typing import Any` 则补。
