# 群聊体验重构：成员即群参与者 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把群协作从「聊天+状态仪表盘」改成「一个真实协作群聊」——组长有辨识度气泡、员工以里程碑发言进群、右栏 DAG 降级为按需鸟瞰抽屉。

**Architecture:** 后端在现有「隔离会话之上的编排+投影」(group_room_service.py) 基础上，给投影消息加 `role`+`milestone` 元数据，并新增三类里程碑（接活/进展/交付）；其中"进展"靠在成员流事件订阅里 diff `write_todos` 得出。前端在消息渲染层按 `role`/`milestone` 分派身份样式与里程碑块，并把常驻右栏换成顶部「队员在场」条 + 可展开 DAG 抽屉。

**Tech Stack:** Python/FastAPI/SQLAlchemy(后端)、pytest；React 19/TanStack/Tailwind v4/shadcn(前端)、vitest。

**关键约定（前后端共识，所有 task 遵守）：** 群消息 `extra_meta` 携带：
```
{
  "role": "user" | "leader" | "worker",       // 身份样式
  "milestone": {                               // 可选；有=里程碑块，无=普通气泡
    "kind": "accepted" | "progress" | "delivered" | "failed" | "cancelled",
    "text": str,
    "artifacts": [str]                         // 可选
  }
}
```
后端 `post_to_timeline(...)` 已支持 `extra_meta` 透传，SSE `room_message` 事件会带这些字段；前端 `useGroupRoom` 落库后从 message 的 metadata 读取。

---

## 文件结构

**后端（apps/server）：**
- Modify `src/service/group_room_service.py` — 新增 `_project_member_milestone`、`accepted` 投影、`write_todos` 订阅器、去抖器；`_project_member_conclusion` 输出加 `milestone`。
- Create `tests/test_group_milestone_projection.py` — 里程碑投影测试。

**前端（apps/web）：**
- Create `src/components/chat/message-blocks/member-milestone-block.tsx` — 里程碑块。
- Create `src/components/chat/message-blocks/member-milestone-block.test.tsx`
- Modify `src/lib/chat/message-classifier.ts`（或其类型源）— 增加 `member-milestone` block kind 与分类。
- Modify `src/components/chat/message-blocks/block-render-map.tsx` — 分派里程碑块。
- Modify `src/components/chat/messages/chat-message-item.tsx` — 组长气泡身份强化（读 `role`）。
- Create `src/components/chat/group/group-presence-bar.tsx` — 顶部「队员在场」条。
- Create `src/components/chat/group/group-presence-bar.test.tsx`
- Modify `src/components/chat/group/group-room-view.tsx` — 去常驻右栏，挂 presence bar + DAG 抽屉。

---

## 阶段 1：后端里程碑投影地基（accepted + delivered/failed 带 milestone）

### Task 1: `delivered`/`failed`/`cancelled` 投影补 `milestone` 元数据

**Files:**
- Modify: `apps/server/src/service/group_room_service.py:680-742`（`_project_member_conclusion`）
- Test: `apps/server/tests/test_group_milestone_projection.py`

- [ ] **Step 1: 写失败测试**

Create `apps/server/tests/test_group_milestone_projection.py`：

```python
import json
import pytest
from src.service.group_room_service import GroupRoomService


class _FakeMsg:
    def __init__(self, content):
        self.content = content


def test_conclusion_completed_carries_delivered_milestone(monkeypatch):
    """成员流完成 → 投影消息 extra_meta 带 role=worker + milestone.kind=delivered。"""
    captured = {}

    def _fake_post(db, room, *, role, content, sender_id, sender_label,
                   extra_meta=None, **kw):
        captured["role"] = role
        captured["extra_meta"] = extra_meta
        captured["content"] = content
        return _FakeMsg(content)

    monkeypatch.setattr(GroupRoomService, "post_to_timeline", staticmethod(_fake_post))
    monkeypatch.setattr(GroupRoomService, "update_member_state", staticmethod(lambda *a, **k: None))

    GroupRoomService._project_member_milestone(
        room=object(), db=None, member_employee_id=7, sender_label="张三",
        member_conversation_id=42, kind="delivered", text="文案已完成",
        artifacts=["a/report.md"],
    )

    assert captured["extra_meta"]["role"] == "worker"
    assert captured["extra_meta"]["milestone"]["kind"] == "delivered"
    assert captured["extra_meta"]["milestone"]["artifacts"] == ["a/report.md"]
```

- [ ] **Step 2: 运行验证失败**

Run: `cd apps/server && uv run pytest tests/test_group_milestone_projection.py -v`
Expected: FAIL（`_project_member_milestone` 不存在）

- [ ] **Step 3: 新增 `_project_member_milestone` 统一投影入口**

在 `group_room_service.py` 的 `_project_member_conclusion` **之前**插入：

```python
    @staticmethod
    def _project_member_milestone(
        *,
        room,
        db,
        member_employee_id: int | None,
        sender_label: str,
        member_conversation_id: int | None,
        kind: str,
        text: str,
        artifacts: list[str] | None = None,
        new_member_state: str | None = None,
        member=None,
    ):
        """统一的成员里程碑投影：把一条带 role+milestone 的消息写到群时间线。

        kind: accepted|progress|delivered|failed|cancelled
        new_member_state/member: 给出时顺带更新成员状态。
        """
        extra_meta = {
            "role": "worker",
            "member_conversation_id": member_conversation_id,
            "milestone": {
                "kind": kind,
                "text": text,
                **({"artifacts": artifacts} if artifacts else {}),
            },
        }
        GroupRoomService.post_to_timeline(
            db, room,
            role="assistant",
            content=text,
            sender_id=member_employee_id,
            sender_label=sender_label,
            extra_meta=extra_meta,
            source_conversation_id=member_conversation_id,
        )
        if new_member_state is not None and member is not None:
            GroupRoomService.update_member_state(db, member, new_member_state)
```

- [ ] **Step 4: 运行验证通过**

Run: `cd apps/server && uv run pytest tests/test_group_milestone_projection.py -v`
Expected: PASS

- [ ] **Step 5: 让 `_project_member_conclusion` 走新入口**

把 `_project_member_conclusion`（行 696-740）三个分支的 `post_to_timeline`+`update_member_state` 调用替换为 `_project_member_milestone`：

completed 分支：
```python
            if status_val == "completed":
                last = db.scalars(
                    select(ConversationMessage)
                    .where(
                        ConversationMessage.conversation_id == member_conv_id,
                        ConversationMessage.role == "assistant",
                    )
                    .order_by(ConversationMessage.id.desc())
                ).first()
                content = (last.content or "").strip() if last else ""
                if not content:
                    content = "（已完成）"
                GroupRoomService._project_member_milestone(
                    room=room, db=db, member_employee_id=member.employee_id,
                    sender_label=sender_label, member_conversation_id=member_conv_id,
                    kind="delivered", text=content,
                    new_member_state="done", member=member,
                )
```

else 分支（保留原 body 拼装逻辑），末尾：
```python
                kind = (
                    "cancelled" if status_val == "cancelled"
                    else "failed"  # interrupted 也归 failed 区，文案区分见 body
                )
                GroupRoomService._project_member_milestone(
                    room=room, db=db, member_employee_id=member.employee_id,
                    sender_label=sender_label, member_conversation_id=member_conv_id,
                    kind=kind, text=body,
                    new_member_state="ready", member=member,
                )
```

- [ ] **Step 6: 运行回归（确保原结论投影测试不挂）**

Run: `cd apps/server && uv run pytest tests/test_group_milestone_projection.py tests/test_group_leader_clarification.py -v`
Expected: PASS

- [ ] **Step 7: 提交**

```bash
git add apps/server/src/service/group_room_service.py apps/server/tests/test_group_milestone_projection.py
git commit -m "feat(group): 成员结论投影统一为 _project_member_milestone(带 role+milestone)"
```

---

### Task 2: 派活时投 `accepted` 里程碑

**Files:**
- Modify: `apps/server/src/service/group_room_service.py`（`dispatch_to_member` 启动成功后）
- Test: `apps/server/tests/test_group_milestone_projection.py`

- [ ] **Step 1: 写失败测试**

追加到 `tests/test_group_milestone_projection.py`：

```python
def test_dispatch_emits_accepted_milestone():
    """_build_accepted_milestone_text 给出简短接活文案（含任务摘要前缀）。"""
    from src.service.group_room_service import _build_accepted_milestone_text
    text = _build_accepted_milestone_text("帮我写一份关于X的市场调研报告并给出结论建议")
    assert text.startswith("收到")
    assert len(text) <= 40
```

- [ ] **Step 2: 运行验证失败**

Run: `cd apps/server && uv run pytest tests/test_group_milestone_projection.py::test_dispatch_emits_accepted_milestone -v`
Expected: FAIL（`_build_accepted_milestone_text` 不存在）

- [ ] **Step 3: 实现文案工具 + 在派活成功处投影**

在 `group_room_service.py` 模块级（`_MENTION_RE` 附近）加：

```python
def _build_accepted_milestone_text(question: str) -> str:
    """接活里程碑文案：'收到，开始处理：<任务摘要>'，截断到 40 字内。"""
    q = (question or "").strip().replace("\n", " ")
    head = q[:22] + ("…" if len(q) > 22 else "")
    return f"收到，开始处理：{head}" if head else "收到，开始处理"
```

在 `dispatch_to_member` 内，`registry.request_start` 返回成功（非 REJECTED）、确认拿到成员私有会话 id 之后（即将 `return conv_id` 前），加：

```python
        # 接活里程碑：让群时间线立刻看到「X 收到、开工了」。
        try:
            GroupRoomService._project_member_milestone(
                room=room, db=db, member_employee_id=member.employee_id,
                sender_label=(employee.name if employee else f"员工#{member.employee_id}"),
                member_conversation_id=conv.id,
                kind="accepted",
                text=_build_accepted_milestone_text(question),
            )
        except Exception:
            logger.warning("project accepted milestone failed conv=%s", conv.id, exc_info=True)
```

（注：`conv` 为成员私有会话对象、`employee` 已在函数前部取得；若变量名不同，按该函数实际局部变量调整。）

- [ ] **Step 4: 运行验证通过**

Run: `cd apps/server && uv run pytest tests/test_group_milestone_projection.py::test_dispatch_emits_accepted_milestone -v`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/server/src/service/group_room_service.py apps/server/tests/test_group_milestone_projection.py
git commit -m "feat(group): 派活成功投 accepted 里程碑(收到、开工)"
```

---

## 阶段 2：前端身份感 + 里程碑块 + 右栏降级

### Task 3: `MemberMilestoneBlock` 组件

**Files:**
- Create: `apps/web/src/components/chat/message-blocks/member-milestone-block.tsx`
- Test: `apps/web/src/components/chat/message-blocks/member-milestone-block.test.tsx`

- [ ] **Step 1: 写失败测试**

```tsx
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { MemberMilestoneBlock } from "./member-milestone-block"

describe("MemberMilestoneBlock", () => {
  it("renders sender name, milestone text and clickable artifact", () => {
    const onOpen = vi.fn()
    render(
      <MemberMilestoneBlock
        senderName="张三"
        kind="delivered"
        text="文案已完成"
        artifacts={["a/report.md"]}
        onOpenArtifact={onOpen}
      />
    )
    expect(screen.getByText("张三")).toBeInTheDocument()
    expect(screen.getByText("文案已完成")).toBeInTheDocument()
    fireEvent.click(screen.getByText("report.md"))
    expect(onOpen).toHaveBeenCalledWith("a/report.md")
  })
})
```

- [ ] **Step 2: 运行验证失败**

Run: `cd apps/web && pnpm vitest run src/components/chat/message-blocks/member-milestone-block.test.tsx`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现组件**

```tsx
import * as React from "react"
import { cn } from "@workspace/ui/lib/utils"

export type MilestoneKind =
  | "accepted"
  | "progress"
  | "delivered"
  | "failed"
  | "cancelled"

const KIND_META: Record<MilestoneKind, { glyph: string; tone: string }> = {
  accepted: { glyph: "▸", tone: "text-blue-600" },
  progress: { glyph: "•", tone: "text-blue-500" },
  delivered: { glyph: "✓", tone: "text-emerald-600" },
  failed: { glyph: "⚠", tone: "text-red-600" },
  cancelled: { glyph: "⏹", tone: "text-muted-foreground" },
}

function fileName(p: string): string {
  const parts = p.split(/[/\\]/)
  return parts[parts.length - 1] || p
}

/** 成员里程碑：一条轻量「汇报」，区别于完整发言气泡。头像由外层消息行已渲染。 */
export function MemberMilestoneBlock({
  senderName,
  kind,
  text,
  artifacts,
  onOpenArtifact,
  className,
}: {
  senderName: string
  kind: MilestoneKind
  text: string
  artifacts?: string[]
  onOpenArtifact?: (path: string) => void
  className?: string
}) {
  const meta = KIND_META[kind] ?? KIND_META.progress
  return (
    <div
      className={cn(
        "flex w-full min-w-0 flex-col gap-1 rounded-lg border border-border/60 bg-muted/30 px-3 py-2",
        className
      )}
    >
      <div className="flex items-center gap-1.5 text-[13px]">
        <span className={cn("shrink-0 font-semibold", meta.tone)}>{meta.glyph}</span>
        <span className="shrink-0 font-medium">{senderName}</span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">{text}</span>
      </div>
      {artifacts && artifacts.length > 0 ? (
        <div className="flex flex-wrap gap-1 pl-5">
          {artifacts.map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => onOpenArtifact?.(a)}
              className="inline-flex max-w-full items-center truncate rounded-md border border-border/60 bg-background px-1.5 py-0.5 text-[11px] text-foreground/80 transition-colors hover:border-primary/40 hover:text-foreground"
              title={a}
            >
              {fileName(a)}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
```

- [ ] **Step 4: 运行验证通过**

Run: `cd apps/web && pnpm vitest run src/components/chat/message-blocks/member-milestone-block.test.tsx`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/components/chat/message-blocks/member-milestone-block.tsx apps/web/src/components/chat/message-blocks/member-milestone-block.test.tsx
git commit -m "feat(group): 新增 MemberMilestoneBlock 里程碑块组件"
```

---

### Task 4: 消息分类识别 milestone → 新 block kind

**Files:**
- Modify: `apps/web/src/lib/chat/message-classifier.ts`
- Test: 同文件已有测试套件（若有），否则在 message-classifier 测试里加

- [ ] **Step 1: 先定位 milestone 元数据进入分类器的形态**

Run: `cd apps/web && rg -n "metadata" src/lib/chat/message-classifier.ts | head -20`
Expected: 看到 classifier 如何读取 message.metadata（确定 milestone 从 `message.metadata.milestone` 读取）。

- [ ] **Step 2: 写失败测试**

在 `message-classifier` 对应测试文件追加（路径以仓库实际为准，如 `src/lib/chat/message-classifier.test.ts`）：

```ts
import { describe, it, expect } from "vitest"
import { classifyMessageBlocks } from "./message-classifier"

describe("milestone classification", () => {
  it("emits a member-milestone block when metadata.milestone present", () => {
    const msg = {
      id: "m1",
      role: "assistant",
      parts: [{ type: "text", text: "文案已完成" }],
      metadata: {
        senderName: "张三",
        role: "worker",
        milestone: { kind: "delivered", text: "文案已完成", artifacts: ["a/r.md"] },
      },
    } as never
    const { blocks } = classifyMessageBlocks(msg, {
      includeFileChanges: false,
      isLastAssistantMessage: false,
      isTurnEnded: true,
    })
    const m = blocks.find((b) => b.kind === "member-milestone")
    expect(m).toBeTruthy()
  })
})
```

(若 classifier 入口函数名不是 `classifyMessageBlocks`，先用 Step 1 的 rg 结果确认实际导出名，并据此改测试与调用。)

- [ ] **Step 3: 运行验证失败**

Run: `cd apps/web && pnpm vitest run src/lib/chat/message-classifier.test.ts`
Expected: FAIL（无 member-milestone block）

- [ ] **Step 4: 实现分类**

在 `message-classifier.ts` 的 `ClassifiedBlock` 联合类型加：

```ts
  | {
      kind: "member-milestone"
      key: string
      senderName: string
      milestoneKind: "accepted" | "progress" | "delivered" | "failed" | "cancelled"
      text: string
      artifacts?: string[]
    }
```

在分类主函数**最前面**（早于 text/tool 分类），加 milestone 短路：

```ts
  const milestone = (message.metadata as Record<string, unknown> | undefined)?.milestone as
    | { kind: string; text: string; artifacts?: string[] }
    | undefined
  if (milestone && typeof milestone.kind === "string") {
    const senderName =
      typeof message.metadata?.senderName === "string"
        ? message.metadata.senderName
        : "成员"
    return {
      blocks: [
        {
          kind: "member-milestone",
          key: `${message.id}:milestone`,
          senderName,
          milestoneKind: milestone.kind as never,
          text: milestone.text,
          artifacts: milestone.artifacts,
        },
      ],
      // 其余分类返回字段保持与现有返回结构一致（toolAutoCollapseMap/commandMeta 等用空默认）
      toolAutoCollapseMap: new Map(),
      commandMeta: {},
      mentionMeta: [],
      filesMeta: [],
    }
  }
```

(返回结构以该函数现有 return 的字段为准——用 Step 1 的 rg 结果对齐字段名，缺哪个补哪个的空默认值。)

- [ ] **Step 5: 运行验证通过**

Run: `cd apps/web && pnpm vitest run src/lib/chat/message-classifier.test.ts`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add apps/web/src/lib/chat/message-classifier.ts apps/web/src/lib/chat/message-classifier.test.ts
git commit -m "feat(group): 分类器识别 metadata.milestone → member-milestone block"
```

---

### Task 5: `block-render-map` 分派里程碑块

**Files:**
- Modify: `apps/web/src/components/chat/message-blocks/block-render-map.tsx:150`（分派链开头）

- [ ] **Step 1: 加 import**

在文件顶部 import 区加：

```tsx
import { MemberMilestoneBlock } from "./member-milestone-block"
```

- [ ] **Step 2: 在 `BlockRenderer` 分派链最前面加分支**

在 `if (block.kind === "tool-group") {` **之前**插入：

```tsx
  if (block.kind === "member-milestone") {
    return (
      <MemberMilestoneBlock
        key={block.key}
        senderName={block.senderName}
        kind={block.milestoneKind}
        text={block.text}
        artifacts={block.artifacts}
        onOpenArtifact={(p) =>
          useArtifactStore.getState().openResource(p)
        }
        className="w-full"
      />
    )
  }
```

(`useArtifactStore` 已在本文件 import；`openResource` 经 `getState()` 取，避免在分派函数里加 hook。)

- [ ] **Step 3: typecheck**

Run: `cd apps/web && pnpm typecheck`
Expected: 无 member-milestone 相关类型错误

- [ ] **Step 4: 提交**

```bash
git add apps/web/src/components/chat/message-blocks/block-render-map.tsx
git commit -m "feat(group): block-render-map 分派 member-milestone 块"
```

---

### Task 6: 组长气泡身份强化（读 `role`）

**Files:**
- Modify: `apps/web/src/components/chat/messages/chat-message-item.tsx:200-247`（群发言人头像区）

- [ ] **Step 1: 让头像区优先按 `metadata.role` 判定组长**

当前判定靠 `senderName === "组长"`（行 228）。改为优先读 `role`，并在组长头像旁补一个「组长」角色徽标。把行 200-247 的 assistant 头像块里组长分支改为：

```tsx
              const senderRole =
                typeof meta?.role === "string" ? meta.role : undefined
              // 组长：role==="leader" 或回退老逻辑 senderName==="组长"
              if (senderRole === "leader" || senderName === "组长") {
                return (
                  <div className="flex items-center gap-1.5">
                    <EmployeeContactAvatar
                      name="组长"
                      avatar={CURATOR_AVATAR_URL}
                      avatarClassName="size-6 ring-2 ring-amber-300/60"
                      fallbackClassName="text-[10px]"
                    />
                    <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                      组长
                    </span>
                  </div>
                )
              }
```

（worker/user 分支不变；这样组长在群里有「群主」辨识度，员工保持朴素头像。）

- [ ] **Step 2: typecheck**

Run: `cd apps/web && pnpm typecheck`
Expected: 通过

- [ ] **Step 3: 手测要点（记录，不阻塞）**

启动后进群发任务：组长气泡左上有金色环头像 +「组长」徽标；员工发言只有朴素头像 + 名字。

- [ ] **Step 4: 提交**

```bash
git add apps/web/src/components/chat/messages/chat-message-item.tsx
git commit -m "feat(group): 组长气泡身份强化(金环头像+组长徽标,读 metadata.role)"
```

---

### Task 7: `GroupPresenceBar` 顶部「队员在场」条

**Files:**
- Create: `apps/web/src/components/chat/group/group-presence-bar.tsx`
- Test: `apps/web/src/components/chat/group/group-presence-bar.test.tsx`

- [ ] **Step 1: 写失败测试**

```tsx
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { GroupPresenceBar } from "./group-presence-bar"

describe("GroupPresenceBar", () => {
  it("shows running count and opens overview on click", () => {
    const onOpen = vi.fn()
    render(
      <GroupPresenceBar
        members={[
          { member_id: 1, employee_id: 1, employee_name: "张三", state: "running", role_in_room: "worker", conversation_id: 9 },
          { member_id: 2, employee_id: 2, employee_name: "李四", state: "ready", role_in_room: "worker", conversation_id: null },
        ] as never}
        onOpenOverview={onOpen}
      />
    )
    expect(screen.getByText(/1 进行中/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /协作流程|队员/ }))
    expect(onOpen).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 运行验证失败**

Run: `cd apps/web && pnpm vitest run src/components/chat/group/group-presence-bar.test.tsx`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现组件**

```tsx
import * as React from "react"
import { Avatar, AvatarFallback } from "@workspace/ui/components/avatar"
import { cn } from "@workspace/ui/lib/utils"
import type { GroupRoomMember } from "@/api/group-room"

function initialOf(name: string | null | undefined): string {
  const t = (name ?? "").trim()
  return t ? t.slice(0, 2) : "员"
}

const PALETTE = [
  "bg-blue-100 text-blue-700",
  "bg-violet-100 text-violet-700",
  "bg-emerald-100 text-emerald-700",
  "bg-rose-100 text-rose-700",
  "bg-cyan-100 text-cyan-700",
]
function colorOf(seed: string | null | undefined): string {
  const s = (seed ?? "").trim() || "员"
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length]
}

/** 顶部「队员在场」条：头像叠加 + N 进行中，点击展开 DAG 鸟瞰抽屉。 */
export function GroupPresenceBar({
  members,
  onOpenOverview,
  className,
}: {
  members: GroupRoomMember[]
  onOpenOverview: () => void
  className?: string
}) {
  const workers = members.filter((m) => m.role_in_room !== "leader")
  const runningCount = workers.filter((m) => m.state === "running").length
  const shown = workers.slice(0, 5)
  const overflow = workers.length - shown.length
  return (
    <button
      type="button"
      onClick={onOpenOverview}
      className={cn(
        "flex w-full items-center gap-2 border-b bg-background/60 px-4 py-2 text-left transition-colors hover:bg-muted/40",
        className
      )}
      aria-label="展开协作流程"
    >
      <div className="flex -space-x-2">
        {shown.map((m) => (
          <Avatar key={m.member_id} className="size-6 ring-2 ring-background">
            <AvatarFallback className={cn("text-[10px] font-semibold", colorOf(m.employee_name))}>
              {initialOf(m.employee_name)}
            </AvatarFallback>
          </Avatar>
        ))}
        {overflow > 0 ? (
          <span className="flex size-6 items-center justify-center rounded-full bg-muted text-[10px] font-medium ring-2 ring-background">
            +{overflow}
          </span>
        ) : null}
      </div>
      <span className="text-xs text-muted-foreground">
        {workers.length} 位队员
        {runningCount > 0 ? (
          <span className="ml-1 text-blue-600">· {runningCount} 进行中</span>
        ) : null}
      </span>
      <span className="ml-auto text-[11px] text-muted-foreground">协作流程 ›</span>
    </button>
  )
}
```

- [ ] **Step 4: 运行验证通过**

Run: `cd apps/web && pnpm vitest run src/components/chat/group/group-presence-bar.test.tsx`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/components/chat/group/group-presence-bar.tsx apps/web/src/components/chat/group/group-presence-bar.test.tsx
git commit -m "feat(group): 新增 GroupPresenceBar 顶部队员在场条"
```

---

### Task 8: `GroupRoomView` 去常驻右栏 → presence bar + DAG 抽屉

**Files:**
- Modify: `apps/web/src/components/chat/group/group-room-view.tsx:137-176`

- [ ] **Step 1: 引入 Sheet + 新组件 + 抽屉开关 state**

在 import 区加：

```tsx
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@workspace/ui/components/sheet"
import { GroupPresenceBar } from "./group-presence-bar"
```

(若 `@workspace/ui/components/sheet` 不存在，先 `cd apps/web && pnpm dlx shadcn@latest add sheet -c .` 安装。)

在组件函数体内加：

```tsx
  const [overviewOpen, setOverviewOpen] = React.useState(false)
```

- [ ] **Step 2: 重写 return 布局：时间线全宽 + 顶部 presence bar + 抽屉**

把 `return (...)`（行 137-176）替换为：

```tsx
  return (
    <div className={cn("flex h-full min-h-0 w-full flex-col", className)} {...props}>
      {members.length > 0 ? (
        <GroupPresenceBar
          members={members}
          onOpenOverview={() => setOverviewOpen(true)}
        />
      ) : null}
      <ConversationChatView
        contact={contact}
        title={title}
        conversationId={conversationId}
        onOpenContacts={onOpenContacts}
        onOpenConversations={onOpenConversations}
        onNewConversation={onNewConversation}
        extraStreamingMessages={extraStreamingMessages}
        groupRoomBusy={groupRoomBusy}
        onGroupRoomStop={handleGroupRoomStop}
        className="min-h-0 min-w-0 flex-1"
      />
      <Sheet open={overviewOpen} onOpenChange={setOverviewOpen}>
        <SheetContent side="right" className="w-[360px] p-0 sm:max-w-[360px]">
          <SheetHeader className="px-4 py-3">
            <SheetTitle>协作流程</SheetTitle>
          </SheetHeader>
          {hasDag && dag ? (
            <GroupSopPanel
              dag={dag}
              conversationId={conversationId}
              groupContactId={groupContactId ?? `group:${conversationId}`}
              memberConversationByEmployeeId={memberConversationByEmployeeId}
              autoConfirm={autoConfirm}
              onAutoConfirmChange={setAutoConfirm}
              className="flex h-[calc(100%-3.5rem)]"
            />
          ) : (
            <GroupMemberSidebar
              members={members}
              title={contact?.group?.name || "群成员"}
              groupContactId={groupContactId}
              groupConversationId={conversationId}
              autoConfirm={autoConfirm}
              onAutoConfirmChange={setAutoConfirm}
              className="flex h-[calc(100%-3.5rem)]"
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
```

(注：外层从 `flex-row` 改 `flex-col`，时间线获得全宽；右栏组件搬进 Sheet，原有 `hidden md:flex` 类去掉。)

- [ ] **Step 3: typecheck**

Run: `cd apps/web && pnpm typecheck`
Expected: 通过

- [ ] **Step 4: 手测要点（记录）**

进群：右侧无常驻栏，时间线全宽；顶部「队员在场」条；点条 → 右侧滑出协作流程抽屉（DAG 或成员列表）。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/components/chat/group/group-room-view.tsx
git commit -m "feat(group): 去常驻右栏,时间线全宽+顶部队员在场条+DAG抽屉"
```

---

## 阶段 3：后端进展里程碑（write_todos 订阅 + 去抖）

### Task 9: 里程碑去抖器

**Files:**
- Modify: `apps/server/src/service/group_room_service.py`（模块级加去抖工具）
- Test: `apps/server/tests/test_group_milestone_projection.py`

- [ ] **Step 1: 写失败测试**

追加：

```python
def test_milestone_debouncer_collapses_rapid_progress():
    from src.service.group_room_service import _MilestoneDebouncer
    d = _MilestoneDebouncer(min_interval_s=3.0)
    now = 1000.0
    assert d.allow(conv_id=42, kind="progress", text="A", now=now) is True
    # 同会话同类短时间内第二条被抑制
    assert d.allow(conv_id=42, kind="progress", text="B", now=now + 1) is False
    # 超过间隔后放行
    assert d.allow(conv_id=42, kind="progress", text="C", now=now + 4) is True
    # 重复文本永远抑制
    assert d.allow(conv_id=42, kind="progress", text="C", now=now + 100) is False
    # accepted/delivered 不参与去抖，永远放行
    assert d.allow(conv_id=42, kind="delivered", text="done", now=now + 4.1) is True
    assert d.allow(conv_id=42, kind="accepted", text="x", now=now + 4.2) is True
```

- [ ] **Step 2: 运行验证失败**

Run: `cd apps/server && uv run pytest tests/test_group_milestone_projection.py::test_milestone_debouncer_collapses_rapid_progress -v`
Expected: FAIL

- [ ] **Step 3: 实现去抖器**

模块级加：

```python
class _MilestoneDebouncer:
    """里程碑去抖：仅对 progress 类做「同会话最小间隔 + 文本去重」。
    accepted/delivered/failed/cancelled 必出，不参与去抖。
    """

    _DEBOUNCED_KINDS = {"progress"}

    def __init__(self, min_interval_s: float = 3.0):
        self._min = min_interval_s
        self._last_ts: dict[int, float] = {}
        self._seen_text: dict[int, set[str]] = {}

    def allow(self, *, conv_id: int, kind: str, text: str, now: float) -> bool:
        if kind not in self._DEBOUNCED_KINDS:
            return True
        seen = self._seen_text.setdefault(conv_id, set())
        if text in seen:
            return False
        last = self._last_ts.get(conv_id)
        if last is not None and (now - last) < self._min:
            return False
        self._last_ts[conv_id] = now
        seen.add(text)
        return True


_milestone_debouncer = _MilestoneDebouncer()
```

- [ ] **Step 4: 运行验证通过**

Run: `cd apps/server && uv run pytest tests/test_group_milestone_projection.py::test_milestone_debouncer_collapses_rapid_progress -v`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/server/src/service/group_room_service.py apps/server/tests/test_group_milestone_projection.py
git commit -m "feat(group): 里程碑去抖器(仅 progress 限速去重,硬里程碑必出)"
```

---

### Task 10: `write_todos` 订阅 → progress 里程碑

**Files:**
- Modify: `apps/server/src/service/group_room_service.py`（`_attach_projector` 的 `_on_event`）
- Test: `apps/server/tests/test_group_milestone_projection.py`

- [ ] **Step 1: 先确认成员流事件里 write_todos 的 event 形态**

Run: `cd apps/server && rg -n "write_todos|todos|tool_call|tool_name|tool" src/service/stream_registry.py | head -30`
还要看成员流 `task.subscribe(_on_event)` 收到的 event dict 结构（`_on_event` 已存在于 `_attach_projector`）。
Expected: 确认 event 里能拿到工具名 + 工具输入（todos 列表）。记录实际字段路径（如 `event["data"]["tool"]` / `event["data"]["input"]["todos"]`）。

- [ ] **Step 2: 写失败测试（纯函数：从前后 todos diff 出新完成项）**

```python
def test_diff_completed_todos_detects_new_completions():
    from src.service.group_room_service import _diff_completed_todos
    prev = [
        {"content": "检索资料", "status": "completed"},
        {"content": "起草", "status": "in_progress"},
    ]
    cur = [
        {"content": "检索资料", "status": "completed"},
        {"content": "起草", "status": "completed"},
        {"content": "校对", "status": "in_progress"},
    ]
    newly = _diff_completed_todos(prev, cur)
    assert newly == ["起草"]
```

- [ ] **Step 3: 运行验证失败**

Run: `cd apps/server && uv run pytest tests/test_group_milestone_projection.py::test_diff_completed_todos_detects_new_completions -v`
Expected: FAIL

- [ ] **Step 4: 实现 diff 纯函数**

模块级加：

```python
def _diff_completed_todos(prev: list[dict] | None, cur: list[dict] | None) -> list[str]:
    """对比前后 todo 列表，返回本次新变为 completed 的条目 content 列表。"""
    prev = prev or []
    cur = cur or []
    prev_done = {
        (t.get("content") or "").strip()
        for t in prev
        if t.get("status") == "completed"
    }
    newly: list[str] = []
    for t in cur:
        c = (t.get("content") or "").strip()
        if c and t.get("status") == "completed" and c not in prev_done:
            newly.append(c)
    return newly
```

- [ ] **Step 5: 运行验证通过**

Run: `cd apps/server && uv run pytest tests/test_group_milestone_projection.py::test_diff_completed_todos_detects_new_completions -v`
Expected: PASS

- [ ] **Step 6: 在 `_attach_projector._on_event` 里挂 todo 观察**

在 `_attach_projector`（行 644）内，给闭包加一个 `prev_todos` 状态盒，并在 `_on_event` 中识别 write_todos 事件（字段路径用 Step 1 的实测结果，下面以 `event["data"]` 含 `tool`+`input` 为例）：

```python
        prev_todos_box: dict[str, list] = {"v": []}

        def _on_event(event: dict) -> None:
            data = event.get("data") if isinstance(event, dict) else None

            # —— 进展里程碑：write_todos 工具调用 → diff 出新完成项 ——
            if isinstance(data, dict):
                tool_name = data.get("tool") or data.get("tool_name")
                if tool_name == "write_todos":
                    tool_input = data.get("input") or {}
                    cur_todos = tool_input.get("todos") or []
                    newly = _diff_completed_todos(prev_todos_box["v"], cur_todos)
                    prev_todos_box["v"] = cur_todos
                    for content in newly:
                        try:
                            GroupRoomService._project_progress_milestone(
                                room_id, member_id, member_conv_id, content
                            )
                        except Exception:
                            logger.warning(
                                "project progress milestone failed conv=%s",
                                member_conv_id, exc_info=True,
                            )

            # —— 原有终态结论投影 ——
            status_val = None
            if isinstance(data, dict):
                status_val = data.get("status")
            elif isinstance(data, str):
                status_val = data
            if status_val in ("completed", "cancelled", "error", "interrupted"):
                try:
                    GroupRoomService._project_member_conclusion(
                        room_id, member_id, member_conv_id, status_val
                    )
                except Exception:
                    logger.warning(
                        "project member conclusion failed conv=%s",
                        member_conv_id, exc_info=True,
                    )
```

(若 Step 1 显示工具事件与状态事件不在同一 event 流/字段，按实测调整识别条件——核心是：拿到 write_todos 的 todos 输入即可。)

- [ ] **Step 7: 实现 `_project_progress_milestone`（独立 Session + 去抖）**

在 `_project_member_milestone` 附近加：

```python
    @staticmethod
    def _project_progress_milestone(
        room_id: int, member_id: int, member_conv_id: int, content: str
    ) -> None:
        """把一个新完成的 todo 作为 progress 里程碑投影到群（经去抖，独立 Session）。"""
        import time
        from src.db.session import get_session_local

        if not _milestone_debouncer.allow(
            conv_id=member_conv_id, kind="progress", text=content, now=time.monotonic()
        ):
            return
        db = get_session_local()()
        try:
            room = db.get(GroupRoom, room_id)
            member = db.get(GroupRoomMember, member_id)
            if room is None or member is None:
                return
            employee = db.get(Employee, member.employee_id)
            sender_label = employee.name if employee else f"员工#{member.employee_id}"
            GroupRoomService._project_member_milestone(
                room=room, db=db, member_employee_id=member.employee_id,
                sender_label=sender_label, member_conversation_id=member_conv_id,
                kind="progress", text=f"已完成：{content}",
            )
        finally:
            db.close()
```

- [ ] **Step 8: 运行全部后端里程碑测试**

Run: `cd apps/server && uv run pytest tests/test_group_milestone_projection.py -v`
Expected: 全 PASS

- [ ] **Step 9: 提交**

```bash
git add apps/server/src/service/group_room_service.py apps/server/tests/test_group_milestone_projection.py
git commit -m "feat(group): write_todos 完成项投 progress 里程碑(经去抖)"
```

---

## 阶段 4：联调与收尾

### Task 11: 全量校验

- [ ] **Step 1: 后端测试**

Run: `cd apps/server && uv run pytest tests/test_group_milestone_projection.py tests/test_group_leader_clarification.py -v`
Expected: 全 PASS

- [ ] **Step 2: 前端测试**

Run: `cd apps/web && pnpm vitest run src/components/chat/message-blocks/member-milestone-block.test.tsx src/components/chat/group/group-presence-bar.test.tsx src/lib/chat/message-classifier.test.ts`
Expected: 全 PASS

- [ ] **Step 3: 类型检查 + lint + format**

Run: `cd apps/web && pnpm typecheck && pnpm lint --filter=web`
Then: `pnpm format`
Expected: 无错误

- [ ] **Step 4: 端到端手测（记录现象，不阻塞提交）**

1. 进群发一个需要拆解的需求 → 组长金环头像+徽标气泡发言。
2. 计划确认执行 → 每个员工接活时群里出现 `▸ X 收到，开始处理：…`。
3. 员工 agent 完成 todo 项 → 群里出现 `• X 已完成：…`（多条快速完成时被去抖合并）。
4. 员工交付 → `✓ X <结论>`，带产物 chip 可点开。
5. 顶部「队员在场」条显示头像叠加 + N 进行中；点击 → 右侧滑出协作流程抽屉。

- [ ] **Step 5: 收尾提交（若 format 改了文件）**

```bash
git add -A && git commit -m "chore(group): 群聊重构 format/lint 收尾"
```

---

## 自检对照（spec 覆盖）

- 时间线为主视图、组长特殊气泡/员工朴素 → Task 6、Task 8 ✓
- 员工里程碑级汇报：接活 → Task 2；进展(todo) → Task 10；交付/失败/取消 → Task 1 ✓
- 里程碑来自硬信号(派发/终态/write_todos) → Task 2/1/10 ✓
- 去抖防刷屏 → Task 9 ✓
- 右栏 DAG 默认收起 + 顶部队员在场条 + 按需抽屉 → Task 7、Task 8 ✓
- 数据契约 role+milestone → Task 1(后端写入) / Task 4(前端读取) ✓
- 澄清卡片维持独立机制(非 milestone) → 全程不触碰澄清路径 ✓
- 不动一会话=一线程=一流隔离 → 投影只读成员流、单向写群，未改流机制 ✓
- DAG 取数/聚合不动 → Task 8 只搬容器(常驻栏→抽屉)，GroupSopPanel 逻辑原样 ✓

**已知不确定点（spec 已声明）：** Task 10 Step 1/6 的 write_todos 事件字段路径需实测确认；若成员流事件管道观察不到 tool-call，progress 里程碑降级为「仅 accepted+delivered」，accepted/delivered/failed 仍由 Task 1/2 保证必出。
