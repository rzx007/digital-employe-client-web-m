# 群组长澄清(HITL)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 群组长在用户需求模糊时,用真正的 HITL 中断先向用户澄清(群时间线结构化卡片),作答后 resume 组长流再把任务派给成员。

**Architecture:** 复用组长 orchestrator 已有的 `submit_clarifying_questions` 中断 + `Command(resume)` 恢复;新增两座桥——中断终态时把澄清问题 parts 投影成群时间线卡片(桥出),群里作答经 `/approve` 打到组长会话并重注册逐字 relay 后 resume(桥回)。仅组长、仅需求模糊时澄清,澄清够即派活不二次确认。

**Tech Stack:** Python / FastAPI / SQLAlchemy / LangGraph(后端);React / TanStack Query / @ai-sdk/react(前端)。测试:`uv run pytest`(后端,`apps/server`)、`vitest run`(前端)。

**Spec:** `docs/superpowers/specs/2026-06-05-group-leader-clarification-hitl-design.md`

---

## File Structure

| 文件 | 职责 | 动作 |
| --- | --- | --- |
| `apps/server/src/service/group_room_service.py` | 组长 brief、桥出投影、awaiting 判定、relay | 修改 |
| `apps/server/src/service/chat_service.py` | `approve_trigger` 新增 group_leader 分支(桥回) | 修改 |
| `apps/web/src/lib/chat/hitl/group-clarify-target.ts` | 群澄清卡片提交目标解析器(双 id) | 新建 |
| `apps/web/src/lib/chat/hitl/group-clarify-target.test.ts` | 解析器单测 | 新建 |
| 群里澄清卡片渲染组件(`ClarifyingQuestionsDock` 调用处) | 提交时用解析器换双 id | 修改 |
| `apps/server/tests/test_group_leader_clarification.py` | 后端桥出/桥回/路由测试 | 新建 |

**约定**:后端测试用 `tests/conftest.py` 的 `db_session` / `workspace` / `add_employee` fixtures。所有后端命令在 `apps/server/` 下执行。

---

## Task 1: 组长 brief 提示词 + 澄清开关(改动点①)

把"模糊则澄清、清晰则派活"的判断写进组长 brief,并确认 `group_leader` 的 `interrupt_on` 含 `submit_clarifying_questions`。把 brief 拼装抽成纯函数便于断言。

**Files:**
- Modify: `apps/server/src/service/group_room_service.py`(`dispatch_to_leader` 内 `leader_brief` 拼装,约 763 行)
- Test: `apps/server/tests/test_group_leader_clarification.py`

- [ ] **Step 1: 写失败测试 — brief 含澄清分支 + interrupt_on 含澄清工具**

新建 `apps/server/tests/test_group_leader_clarification.py`:

```python
from __future__ import annotations

from src.service.group_room_service import build_leader_brief
from src.service.agent.destructive_hitl import build_orchestrator_interrupt_on


def test_leader_brief_includes_clarify_branch() -> None:
    brief = build_leader_brief(question="帮我写个文档", roster="- 张三（员工ID: 1）")
    assert "submit_clarifying_questions" in brief
    assert "模糊" in brief or "信息不足" in brief
    assert "帮我写个文档" in brief
    assert "张三" in brief


def test_orchestrator_interrupt_on_has_clarify() -> None:
    interrupt_on = build_orchestrator_interrupt_on(None)
    assert "submit_clarifying_questions" in interrupt_on
```

- [ ] **Step 2: 运行,确认失败**

Run: `uv run pytest tests/test_group_leader_clarification.py -v`
Expected: FAIL（`build_leader_brief` 未定义 / ImportError）

- [ ] **Step 3: 抽出 `build_leader_brief` 纯函数并改写 brief**

在 `group_room_service.py` 模块级(类外)新增,并让 `dispatch_to_leader` 调用它替换原内联 `leader_brief`:

```python
def build_leader_brief(question: str, roster: str) -> str:
    return (
        "你是这个群的组长（调度员）。没有真人会替你点“确认执行”，"
        "但当用户需求模糊时你必须先澄清，不能凭空臆测。\n"
        "群里现有以下成员可供你分派任务：\n"
        f"{roster}\n\n"
        "判断用户需求是否清晰：\n"
        "- 若关键信息不足以拆解派活（目标 / 范围 / 交付物 / 受众 / 格式 等任一不明），"
        "**本轮必须调用 `submit_clarifying_questions`**（context 取 long_document 或 general）"
        "一次性列清要点；调用后停下，**不要** create_orchestration_plan、不要派活，"
        "等用户回答后的下一轮再继续。禁止只在聊天里列问题而不调工具。\n"
        "- 若需求已清晰：先用一句话说你的安排，再 create_orchestration_plan、"
        "随后立即 confirm_orchestration_plan 执行（互不依赖可并行，有先后用 depends_on）。\n"
        "成员产出会自动汇总到群里。\n\n"
        f"用户需求：{question}"
    )
```

`dispatch_to_leader` 内：`leader_brief = build_leader_brief(question, roster)`(删除原内联拼装)。

- [ ] **Step 4: 运行,确认通过**

Run: `uv run pytest tests/test_group_leader_clarification.py -v`
Expected: PASS（两个测试）

- [ ] **Step 5: 提交**

```bash
git add apps/server/src/service/group_room_service.py apps/server/tests/test_group_leader_clarification.py
git commit -m "feat(group-leader): 组长 brief 支持模糊需求先澄清(改动点①)"
```

---

## Task 2: 桥出 — interrupted 投影成群卡片(改动点②+④)

组长流以 `interrupted` 终态结束时,把那条 interrupted assistant 消息的 parts 投影成群时间线一条带 `clarify_*` extra_meta 的消息;**先于 `_project_simple` 处理并 early-return**,避免落入 completed 逻辑/误回流总管。

**Files:**
- Modify: `apps/server/src/service/group_room_service.py`(`project_member_conversation_if_in_room` 分支 A,约 1509-1528)
- Test: `apps/server/tests/test_group_leader_clarification.py`

- [ ] **Step 1: 写失败测试 — interrupted 投影出群卡片消息**

追加到测试文件(需要构造 room + 组长会话 + 一条 interrupted assistant 消息):

```python
import json
from sqlalchemy import select
from src.models.conversation import Conversation, ConversationMessage
from src.models.group_room import GroupRoom
from src.service.group_room_service import project_member_conversation_if_in_room


def _make_room_with_leader(db_session, workspace):
    group_conv = Conversation(workspace_id=workspace.id, target_type="group", target_id=1, title="群")
    db_session.add(group_conv); db_session.flush()
    leader_conv = Conversation(workspace_id=workspace.id, target_type="group_leader",
                               target_id=group_conv.id, title="组长")
    db_session.add(leader_conv); db_session.flush()
    room = GroupRoom(workspace_id=workspace.id, room_conversation_id=group_conv.id,
                     leader_conversation_id=leader_conv.id)
    db_session.add(room); db_session.commit()
    return room, group_conv, leader_conv


def test_interrupted_leader_projects_clarify_card(db_session, workspace, monkeypatch):
    # project 用独立 session：让它读到本测试 session 提交的数据
    monkeypatch.setattr(
        "src.db.session.get_session_local",
        lambda: (lambda: db_session),
    )
    room, group_conv, leader_conv = _make_room_with_leader(db_session, workspace)
    parts = [{"type": "clarifying_questions", "questions": ["主题?", "受众?"]}]
    interrupted = ConversationMessage(
        conversation_id=leader_conv.id, role="assistant", content="",
        stream_state="interrupted", message_parts=json.dumps(parts, ensure_ascii=False),
    )
    db_session.add(interrupted); db_session.commit()

    project_member_conversation_if_in_room(leader_conv.id, "interrupted")

    card = db_session.scalars(
        select(ConversationMessage)
        .where(ConversationMessage.conversation_id == group_conv.id,
               ConversationMessage.role == "assistant")
        .order_by(ConversationMessage.id.desc())
    ).first()
    assert card is not None
    meta = json.loads(card.extra_meta or "{}")
    assert meta["clarify_target_conversation_id"] == leader_conv.id
    assert meta["clarify_message_id"] == interrupted.id
    assert "clarifying_questions" in (card.message_parts or "")
```

> 注:`monkeypatch` 把 `get_session_local` 换成返回当前测试 session,因为 `project_member_conversation_if_in_room` 内部自建 session。若工程已有更标准的 DB patch 方式(参考 conftest 的 `patched_*_db`),改用之。

- [ ] **Step 2: 运行,确认失败**

Run: `uv run pytest tests/test_group_leader_clarification.py::test_interrupted_leader_projects_clarify_card -v`
Expected: FAIL（未投影出 card / extra_meta 缺字段）

- [ ] **Step 3: 在分支 A 增加 interrupted 处理(early-return)**

`project_member_conversation_if_in_room` 分支 A(`leader_room is not None`)内,在调用 `_project_simple` **之前**插入:

```python
if leader_room is not None:
    if stream_state == "interrupted":
        # 桥出:把组长澄清问题投影成群时间线卡片(带回 approve 目标)
        last = db.scalars(
            select(ConversationMessage)
            .where(
                ConversationMessage.conversation_id == conversation_id,
                ConversationMessage.role == "assistant",
                ConversationMessage.stream_state == "interrupted",
            )
            .order_by(ConversationMessage.id.desc())
        ).first()
        if last is not None and last.message_parts:
            GroupRoomService.post_to_timeline(
                db, leader_room,
                role="assistant",
                content=(last.content or "").strip() or "请补充以下信息后我再安排：",
                sender_id=None,
                sender_label="组长",
                extra_meta={
                    "clarify_target_conversation_id": conversation_id,
                    "clarify_message_id": last.id,
                    "message_parts": json.loads(last.message_parts),
                },
            )
        return  # early-return:不落入 completed/_project_simple,不回流总管
    _project_simple(db, leader_room, conversation_id, stream_state, "组长", sender_id=None)
    ...  # 原 completed 回流逻辑保持不变
```

> `post_to_timeline` 当前签名不写入 `message_parts` 列——若群卡片渲染需要 parts 落在 `ConversationMessage.message_parts`,在本步同时给 `post_to_timeline` 增加可选 `message_parts: list | None = None` 形参并写入该列(参考既有 `extra_meta` 写法)。测试断言 `card.message_parts` 含 `clarifying_questions`,据此决定:要么把 parts 放进 `message_parts` 列(推荐,前端卡片组件按 parts 渲染),要么仅放 `extra_meta.message_parts`。**实现时二选一并让测试断言与之一致。**

- [ ] **Step 4: 运行,确认通过**

Run: `uv run pytest tests/test_group_leader_clarification.py -v`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/server/src/service/group_room_service.py apps/server/tests/test_group_leader_clarification.py
git commit -m "feat(group-leader): 中断澄清投影成群时间线卡片(改动点②④)"
```

---

## Task 3: 桥回 — approve_trigger 新增 group_leader 分支(改动点③后端)★核心

让 `/approve` 能作用于组长会话:重建组长 orchestrator agent、重注册群 relay、透传 orchestrator 上下文给 `approve_and_resume`。

**Files:**
- Modify: `apps/server/src/service/chat_service.py`(`approve_trigger`,1148-1195)
- Test: `apps/server/tests/test_group_leader_clarification.py`

- [ ] **Step 1: 写失败测试 — group_leader 会话 approve 被接受并重注册 relay**

```python
import asyncio
import src.service.group_room_service as grs
from src.service.chat_service import ChatService


def test_approve_trigger_group_leader_branch(db_session, workspace, monkeypatch):
    room, group_conv, leader_conv = _make_room_with_leader(db_session, workspace)
    interrupted = ConversationMessage(
        conversation_id=leader_conv.id, role="assistant", content="",
        stream_state="interrupted",
        message_parts=json.dumps([{"type": "clarifying_questions"}], ensure_ascii=False),
        extra_meta="{}",
    )
    db_session.add(interrupted); db_session.commit()

    monkeypatch.setattr(
        "src.service.agent.orchestrator.get_orchestrator_agent",
        lambda **kw: object(),
    )
    captured = {}

    async def fake_resume(**kw):
        captured.update(kw)
        from src.service.agent_stream_queue import StartResult
        return StartResult.STARTED

    from src.service.stream_registry import registry
    monkeypatch.setattr(registry, "approve_and_resume", fake_resume)

    result = asyncio.run(ChatService.approve_trigger(
        db_session, leader_conv.id, interrupted.id,
        decisions=[{"type": "respond", "message": "市场周报,管理层,1页,markdown"}],
        auth_token="t",
    ))

    assert result["accepted"] is True
    assert leader_conv.id in grs._GROUP_STREAM_RELAY        # relay 已重注册
    assert captured["orchestrator_conversation_id"] == leader_conv.id
    assert captured["orchestrator_workspace_id"] == workspace.id
    assert captured["decisions"][0]["type"] == "respond"
```

- [ ] **Step 2: 运行,确认失败**

Run: `uv run pytest tests/test_group_leader_clarification.py::test_approve_trigger_group_leader_branch -v`
Expected: FAIL（命中 `else: 不支持的 target_type` → accepted False）

- [ ] **Step 3: 在 approve_trigger 增加 group_leader 分支**

在 `approve_trigger` 的 `elif target_type == "employee":` 之后、`else:` 之前插入:

```python
        elif target_type == "group_leader":
            from src.service.agent.orchestrator import get_orchestrator_agent
            from src.models.group_room import GroupRoom
            from src.service.group_room_service import register_group_stream_relay

            room = db.scalars(
                select(GroupRoom).where(
                    GroupRoom.leader_conversation_id == conversation_id
                )
            ).first()
            if room is None:
                return {"accepted": False, "message": "未找到组长所属房间"}

            from pathlib import Path
            shared = str(Path(settings.artifacts_path) / f"room-{room.id}" / "artifacts")
            agent = get_orchestrator_agent(
                workspace_id=conversation.workspace_id,
                db=db,
                conversation_id=conversation_id,
                auth_token=auth_token,
                shared_artifacts_dir=shared,
                bind_context=False,  # 实参逐一对齐 dispatch_to_leader
            )
            # 重注册群流中继:resume 后组长输出继续逐字进群时间线
            register_group_stream_relay(
                conversation_id,
                room_id=room.id,
                room_conversation_id=room.room_conversation_id,
                workspace_id=room.workspace_id,
                sender_id=None,
                sender_label="组长",
            )
```

并把 `approve_and_resume` 的 orchestrator_* 透传条件从"仅 curator"扩为"curator 或 group_leader":

```python
        _is_orch = target_type in ("curator", "group_leader")
        start_result = await registry.approve_and_resume(
            conversation_id=conversation_id,
            agent=agent,
            config=config,
            stream_msg_id=new_msg.id,
            decisions=decisions,
            orchestrator_workspace_id=(conversation.workspace_id if _is_orch else None),
            orchestrator_conversation_id=(conversation_id if _is_orch else None),
            orchestrator_auth_token=(auth_token if _is_orch else None),
        )
```

> 注:若运行期出现 "concurrent operations are not permitted"(组长会话与工具线程共享 session),改为像 `dispatch_to_leader` 用独立 `leader_db` 并传 `orchestrator_owned_db=leader_db`。先按上面最简实现,联调暴露再加。

- [ ] **Step 4: 运行,确认通过**

Run: `uv run pytest tests/test_group_leader_clarification.py -v`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/server/src/service/chat_service.py apps/server/tests/test_group_leader_clarification.py
git commit -m "feat(group-leader): approve_trigger 支持 group_leader resume(改动点③)"
```

---

## Task 4: handle_group_message 待澄清路由 + 兜底(改动点⑤)

抽出"组长是否待澄清"纯判定,接入 `handle_group_message`:待澄清态下普通消息走 resume 兜底,否则原 `dispatch_to_leader`。

**Files:**
- Modify: `apps/server/src/service/group_room_service.py`(`handle_group_message`,约 472;新增 `leader_awaiting_clarification`)
- Test: `apps/server/tests/test_group_leader_clarification.py`

- [ ] **Step 1: 写失败测试 — 待澄清判定**

```python
from src.service.group_room_service import GroupRoomService

def test_leader_awaiting_clarification(db_session, workspace):
    room, group_conv, leader_conv = _make_room_with_leader(db_session, workspace)
    assert GroupRoomService.leader_awaiting_clarification(db_session, room) is False
    db_session.add(ConversationMessage(
        conversation_id=leader_conv.id, role="assistant", content="",
        stream_state="interrupted",
        message_parts=json.dumps([{"type": "clarifying_questions"}], ensure_ascii=False),
    ))
    db_session.commit()
    assert GroupRoomService.leader_awaiting_clarification(db_session, room) is True
```

- [ ] **Step 2: 运行,确认失败**

Run: `uv run pytest tests/test_group_leader_clarification.py::test_leader_awaiting_clarification -v`
Expected: FAIL（方法不存在）

- [ ] **Step 3: 实现判定 + 接入路由**

`GroupRoomService` 内新增:

```python
    @staticmethod
    def leader_awaiting_clarification(db: Session, room: GroupRoom) -> bool:
        if room.leader_conversation_id is None:
            return False
        last = db.scalars(
            select(ConversationMessage)
            .where(
                ConversationMessage.conversation_id == room.leader_conversation_id,
                ConversationMessage.role == "assistant",
            )
            .order_by(ConversationMessage.id.desc())
        ).first()
        return bool(last and last.stream_state == "interrupted")
```

`handle_group_message` 内,在 "2.5) 未 @ 任何成员 → 交给组长统筹" 之前(即 `if not targets:` 分支里)加待澄清兜底:

```python
        if not targets:
            if GroupRoomService.leader_awaiting_clarification(db, room):
                # 兜底:把普通消息当澄清作答,resume 组长流(等价卡片提交)
                last = db.scalars(
                    select(ConversationMessage)
                    .where(
                        ConversationMessage.conversation_id == room.leader_conversation_id,
                        ConversationMessage.role == "assistant",
                        ConversationMessage.stream_state == "interrupted",
                    )
                    .order_by(ConversationMessage.id.desc())
                ).first()
                if last is not None:
                    import asyncio
                    from src.service.chat_service import ChatService
                    asyncio.run_coroutine_threadsafe(
                        ChatService.approve_trigger(
                            db, room.leader_conversation_id, last.id,
                            decisions=[{"type": "respond", "message": question}],
                            auth_token=auth_token,
                        ),
                        get_main_loop(),
                    )
                    return {"room_id": room.id, "dispatched": [], "note": "已作为澄清作答恢复组长"}
            leader_conv_id = GroupRoomService.dispatch_to_leader(
                db, room, question, auth_token=auth_token
            )
            return {...}  # 原返回保持
```

> `get_main_loop` 已在本模块用于 `_schedule_stream_start`,复用其 import。线程/事件循环细节按现有 `_schedule_stream_start` 的方式对齐(本步以通过单测为准,联调时核对协程投递)。

- [ ] **Step 4: 运行,确认通过**

Run: `uv run pytest tests/test_group_leader_clarification.py -v`
Expected: PASS（全文件）

- [ ] **Step 5: 提交**

```bash
git add apps/server/src/service/group_room_service.py apps/server/tests/test_group_leader_clarification.py
git commit -m "feat(group-leader): 待澄清态普通消息兜底 resume(改动点⑤)"
```

---

## Task 5: 前端 — 群澄清卡片提交换双 id(改动点③前端)

新增纯解析器从群消息 `extra_meta` 取 `clarify_target_conversation_id` / `clarify_message_id`,卡片提交时用它覆盖 `approveHitl` 的两个 id。

**Files:**
- Create: `apps/web/src/lib/chat/hitl/group-clarify-target.ts`
- Test: `apps/web/src/lib/chat/hitl/group-clarify-target.test.ts`
- Modify: 群里渲染澄清卡片并调用 `approveHitl` 的处(`ClarifyingQuestionsDock` 在群上下文的调用点)

- [ ] **Step 1: 写失败测试**

新建 `apps/web/src/lib/chat/hitl/group-clarify-target.test.ts`:

```typescript
import { describe, it, expect } from "vitest"
import { resolveGroupClarifyTarget } from "./group-clarify-target"

describe("resolveGroupClarifyTarget", () => {
  it("从 extra_meta 取组长会话 id 与中断消息 id", () => {
    const meta = { clarify_target_conversation_id: 42, clarify_message_id: 99 }
    expect(resolveGroupClarifyTarget(meta)).toEqual({
      conversationId: 42,
      messageId: 99,
    })
  })

  it("缺字段返回 null", () => {
    expect(resolveGroupClarifyTarget({})).toBeNull()
    expect(resolveGroupClarifyTarget(undefined)).toBeNull()
  })
})
```

- [ ] **Step 2: 运行,确认失败**

Run: `cd apps/web && pnpm vitest run src/lib/chat/hitl/group-clarify-target.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现解析器**

新建 `apps/web/src/lib/chat/hitl/group-clarify-target.ts`:

```typescript
export interface GroupClarifyTarget {
  conversationId: number
  messageId: number
}

/** 群澄清卡片:从消息 extra_meta 取出"应把 /approve 打到哪个组长会话/中断消息"。 */
export function resolveGroupClarifyTarget(
  meta: Record<string, unknown> | undefined | null
): GroupClarifyTarget | null {
  if (!meta) return null
  const conv = meta.clarify_target_conversation_id
  const msg = meta.clarify_message_id
  if (typeof conv === "number" && typeof msg === "number") {
    return { conversationId: conv, messageId: msg }
  }
  return null
}
```

- [ ] **Step 4: 运行,确认通过**

Run: `cd apps/web && pnpm vitest run src/lib/chat/hitl/group-clarify-target.test.ts`
Expected: PASS

- [ ] **Step 5: 接入卡片提交**

在群时间线渲染澄清卡片的组件里(`ClarifyingQuestionsDock` 群上下文调用点):提交前 `const t = resolveGroupClarifyTarget(message.metadata)`;若 `t` 非空,调用 `approveHitl(t.conversationId, t.messageId, decisions)`(`decisions` 用 respond 形态),否则沿用原 1:1 逻辑。确保走的是合法 DbMessageId 分支(`isValidApproveMessageId`)。

- [ ] **Step 6: 类型检查 + 提交**

Run: `cd apps/web && pnpm typecheck`
Expected: 无报错

```bash
git add apps/web/src/lib/chat/hitl/group-clarify-target.ts apps/web/src/lib/chat/hitl/group-clarify-target.test.ts
git add <修改的卡片组件文件>
git commit -m "feat(group-leader): 群澄清卡片提交到组长会话(双 id)(改动点③前端)"
```

---

## Task 6: 端到端手动验证

无法纯单测的全链路,手动跑一遍。

**Files:** 无(手动)

- [ ] **Step 1: 起服务**

后端:`apps/server` 下 `uv run uvicorn src.server:app --reload --host 0.0.0.0 --port 58000`;前端:`pnpm dev`。

- [ ] **Step 2: 模糊需求触发澄清**

在一个 ≥2 成员的群里发"帮我写个文档" → 群时间线应出现**组长澄清卡片**(主题/受众/篇幅/格式),且**不应**出现成员派活/DAG 进展。

- [ ] **Step 3: 作答 resume**

在卡片上作答提交 → 组长流恢复(逐字进群)→ 拆解 → 成员开始执行 → 成员结论投影回群 → 组长汇总。确认 DevTools Network 里 `/approve` 打到的是**组长会话 id**(非群会话 id)。

- [ ] **Step 4: 清晰需求不打扰**

发一条信息完整的需求(如"把 /uploads/a.csv 汇总成一页 markdown 发我,给我自己看") → 组长**直接**拆解派活,不弹澄清卡片。

- [ ] **Step 5: 兜底**

待澄清态下,不点卡片、直接在群里发普通文字答案 → 也能 resume 组长(改动点⑤)。

- [ ] **Step 6: 回归 1:1**

普通 1:1 员工对话发一条需澄清的消息 → 澄清卡片与作答 resume 行为不变(确认 group_leader 分支未影响既有 curator/employee 路径)。

---

## 完成标准

- 后端 `uv run pytest tests/test_group_leader_clarification.py` 全绿。
- 前端 `pnpm vitest run src/lib/chat/hitl/group-clarify-target.test.ts` 全绿、`pnpm typecheck` 通过。
- Task 6 手动清单全部通过,尤其 Step 6 的 1:1 回归。
