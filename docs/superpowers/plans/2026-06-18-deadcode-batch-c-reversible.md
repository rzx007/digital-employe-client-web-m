# Batch C 死代码清理（契约层·仅可逆部分）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 删除 group 概念退场后残留的死代码（前端 group 分支/组件/sender 时间线管线 + 后端 sender DTO 字段/enum/is_group），全部可逆（无 DB 列 DROP、无迁移）。

**Architecture:** 纯删除 + 收窄。前后端成对：后端停发 sender DTO 字段，前端同步摘除其读路径；`TargetType` Literal 收窄去掉 `"group"`，连带删除运行时永不可达的 group 分支。**不动 DB 列**（`sender_id`/`sender_label`/`chunk_json`/`stream_chunks` 列保留，留独立迁移 PR）。

**Tech Stack:** React 19 + TS（apps/web）、FastAPI + Pydantic + SQLAlchemy（apps/server）。

**验证基线（动手前先跑一遍确认基线数字，删除后必须不新增）：**
- 后端：`cd apps/server && uv run pytest -q` → 基线约 **5 failed（既有）/ 600+ passed**。删除后 failed 数不得增加。
- 前端类型：`cd apps/web && npx tsc -p tsconfig.app.json --noEmit` → 基线约 **90 errors（既有）**。删除后不得新增（收窄 union 后若出现新的 exhaustiveness 报错，说明还有未删的 group 分支，需补删）。
- 前端单测：`cd apps/web && npx vitest run` → 基线 **1 failed（resolve-workbench-curator-panel，既有）**。删除后不得新增；`merge-consecutive-assistant-messages` 相关测试须仍绿。
- **绝不触碰用户并行 WIP**：`reflection_engine.py`、`test_signal_critic.py`、`AGENTS.md`、`prompts.py` 的抽检改动。本计划任一文件都不涉及这些。

**通则：本计划是死代码删除，非 TDD——不新增测试，验证 = 上述基线套件保持绿/不新增失败。每个任务删完先 grep 确认零引用，再跑对应基线，再 commit。**

---

### Task 1: 前端 — 删 `ContactType "group"` + `Contact.group` + 死分支

**核实背景（2026-06-18 survey）：** `fetchContacts()` 已不再产出 `type:"group"`（仅 curator/employee），`recent-conversations/` 整目录已删（c6634c4c）。故所有 `type==="group"` 分支运行时不可达。

**Files:**
- Modify: `apps/web/src/types/chat.ts`（`ContactType` union 去 `"group"`；删 `Contact.group?` 字段）
- Modify: `apps/web/src/lib/chat/contact-utils.ts`（删 `contact.type === "group"` 分支）
- Modify: `apps/web/src/lib/chat/contact-target.ts`（删 group 分支）

- [ ] **Step 1: 先 grep 全量定位**

Run: `cd apps/web && rg -n '"group"|\.group\b|type === "group"|isGroup' src/types/chat.ts src/lib/chat/`
确认当前实际行号与引用面（行号可能已漂移，以实际为准）。同时 `rg -n 'contact\.group|\.group\b' src/` 确认 `Contact.group` 无其它读者。

- [ ] **Step 2: 删 `ContactType` 的 `"group"` 与 `Contact.group` 字段**

`types/chat.ts`：`ContactType` 收窄为不含 `"group"` 的 union；删除 `Contact` 接口里的 `group?: {...}` 字段块。

- [ ] **Step 3: 删 `contact-utils.ts` / `contact-target.ts` 的 group 分支**

删除 `getContactId` / `findContactInList` / `mapContactToTarget` 等处的 `if (contact.type === "group")` 分支及其 fallback。若某 `switch`/三元因去掉 group 而逻辑等价，简化之。

- [ ] **Step 4: 类型校验（关键 exhaustiveness 闸）**

Run: `cd apps/web && npx tsc -p tsconfig.app.json --noEmit 2>&1 | rg -c 'error'`
Expected: ≤ 基线（约 90）。**若出现新报错且指向某处 `type` 的穷尽性 / 缺失 `group` 分支 → 那正是还没删干净的 group 死分支，补删后再校验。** 记录所有因收窄而新暴露的 group 引用点并清理。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/types/chat.ts apps/web/src/lib/chat/contact-utils.ts apps/web/src/lib/chat/contact-target.ts
git commit -m "refactor(chat): 删除 group ContactType 与 Contact.group 死分支(契约层清理)"
```

---

### Task 2: 前端 — 删 `GroupMembersAvatar`（零消费者）

**核实背景：** 组件零导入者，仅 barrel 再导出。其唯一历史消费者 `recent-conversation-row.tsx` 已随 recent-conversations 删除。

**Files:**
- Modify: `apps/web/src/components/chat/contacts/contact-avatars.tsx`（删 `GroupMembersAvatar` 定义）
- Modify: `apps/web/src/components/chat/contact-avatars.tsx`（删 barrel 再导出）

- [ ] **Step 1: 再确认零消费者**

Run: `cd apps/web && rg -n 'GroupMembersAvatar' src/`
Expected: 仅命中定义文件 + barrel 再导出，无其它导入点。若有意外消费者 → 停，回报。

- [ ] **Step 2: 删组件定义 + barrel 导出**

删 `contacts/contact-avatars.tsx` 里 `GroupMembersAvatar` 整个组件；删 `contact-avatars.tsx` barrel 中对应 export 行。检查该组件是否用到了仅它在用的 import（如某 avatar util），一并清理孤儿 import。

- [ ] **Step 3: 类型校验**

Run: `cd apps/web && npx tsc -p tsconfig.app.json --noEmit 2>&1 | rg -c 'error'`
Expected: ≤ 基线。

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/chat/contacts/contact-avatars.tsx apps/web/src/components/chat/contact-avatars.tsx
git commit -m "refactor(chat): 删除零消费者 GroupMembersAvatar 组件"
```

---

### Task 3: 前后端成对 — 删 sender 时间线管线（DTO 字段 + 前端读路径）

**核实背景（关键）：** 后端**全量零写入** `sender_id`/`sender_label`（新的总管编排/QA/返工代码均不写，`ChatService._append_message` 不写）。故前端 `senderName`/`senderId` 永远拿不到值，`isGroupTimelineMessage()` 条件恒 false。本任务：后端 DTO 停发 + 前端摘除读路径。**不删 DB 列、不删 model 列**（留独立迁移）。

**Files:**
- Modify: `apps/server/src/schemas/conversation.py`（消息 DTO 删 `sender_id`/`sender_label` 字段；**不动 models 列**）
- Modify: `apps/web/src/api/types.ts`（消息 DTO 删 `sender_id?`/`sender_label?`）
- Modify: `apps/web/src/lib/chat/merge-consecutive-assistant-messages.ts`（删 `isGroupTimelineMessage()` + `AssistantMeta.senderName/senderId`）
- Modify: `apps/web/src/lib/chat/message-utils.ts`（删 senderName/senderId 读取/写入）
- Modify: `apps/web/src/lib/chat/chat-mappers.ts`（删 `sender_id`/`sender_label` 映射）

- [ ] **Step 1: 后端核实零写入 + 无测试依赖**

Run: `cd apps/server && rg -n 'sender_id|sender_label' src/ tests/`
确认：`src/` 无 `sender_id=`/`sender_label=` 写入（仅 model 列定义 + DTO + init_db）；`tests/` 无断言依赖这两字段的 DTO 输出。**若有测试断言其值 → 停，回报。**

- [ ] **Step 2: 后端 DTO 删字段（保留 model 列）**

`schemas/conversation.py`：从消息读 DTO 删 `sender_id`/`sender_label` 字段定义。**不要动 `models/conversation.py` 的列**（DB 列保留，序列化层不再暴露即可）。确认无 `from_attributes`/手动赋值再引用这两字段。

- [ ] **Step 3: 后端基线**

Run: `cd apps/server && uv run pytest -q 2>&1 | tail -3`
Expected: failed 数 ≤ 基线（约 5）。

- [ ] **Step 4: 前端删 DTO 字段 + sender 读路径**

- `api/types.ts`：删消息类型里的 `sender_id?`/`sender_label?`。
- `chat-mappers.ts`：删把 `msg.sender_id`/`msg.sender_label` 映射进 Message/meta 的代码块。
- `message-utils.ts`：删 `senderName`/`senderId` 的读取与往 UIMessage meta 的写入。
- `merge-consecutive-assistant-messages.ts`：删 `isGroupTimelineMessage()` 函数及其调用点（调用处合并逻辑回落为普通连续 assistant 合并）；删 `AssistantMeta` 的 `senderName`/`senderId` 字段。

- [ ] **Step 5: 前端类型 + 单测**

Run: `cd apps/web && npx tsc -p tsconfig.app.json --noEmit 2>&1 | rg -c 'error'`（Expected ≤ 基线）
Run: `cd apps/web && npx vitest run 2>&1 | tail -5`（Expected: failed 数 ≤ 基线 1；merge 相关测试仍绿——若该测试本身断言了 group 时间线行为，按"删除 group 行为"语义更新断言，不得引入新依赖）

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/schemas/conversation.py apps/web/src/api/types.ts apps/web/src/lib/chat/merge-consecutive-assistant-messages.ts apps/web/src/lib/chat/message-utils.ts apps/web/src/lib/chat/chat-mappers.ts
git commit -m "refactor(chat): 停发并摘除 sender 时间线 DTO 字段(零写入死字段;DB 列留独立迁移)"
```

---

### Task 4: 后端 — `TargetType` 收窄 + 去重 + 删 `is_group` + 修过期文案

**核实背景：** `TargetType` 在两处重复定义（`schemas/conversation.py`、`schemas/recent_contact.py`），均含不可达的 `"group"`；`RecentContactRead.is_group` 恒 False（仅未知 target_type fallback 才 True，真实数据永不触发）；`chat_service.py` 有处过期报错文案仍写"employee、group 或 curator"。

**Files:**
- Modify: `apps/server/src/schemas/conversation.py`（`TargetType` 收窄为 `Literal["employee", "curator"]`）
- Modify: `apps/server/src/schemas/recent_contact.py`（删重复 `TargetType` 定义，改 import；删 `is_group` 字段）
- Modify: `apps/server/src/service/recent_contact_service.py`（删 `is_group` 赋值/相关 fallback 分支）
- Modify: `apps/server/src/service/chat_service.py`（修过期文案；处理收窄后 `target_type == "group"` 死分支）

- [ ] **Step 1: 全量定位**

Run: `cd apps/server && rg -n 'TargetType|target_type|is_group|"group"|群组功能已下线|employee、group' src/ tests/`
列出所有 group/is_group/target_type 引用点与测试依赖。**若有测试断言 `is_group` 或传 `target_type="group"` 期望特定行为 → 记录，删除时同步更新。**

- [ ] **Step 2: 收窄 `TargetType` + 去重**

`schemas/conversation.py`：`TargetType = Literal["employee", "curator"]`。
`schemas/recent_contact.py`：删本地重复定义，改 `from src.schemas.conversation import TargetType`（避免循环导入；若有循环风险则就地收窄为同一 Literal 并加注释）。

- [ ] **Step 3: 删 `is_group`**

`schemas/recent_contact.py`：删 `RecentContactRead.is_group` 字段。
`recent_contact_service.py`：删构造时的 `is_group=...` 赋值及 `_resolve_display()` 里仅为 is_group 服务的 fallback 分支（保留 display_name/其它返回值）。

- [ ] **Step 4: 修文案 + 清理收窄后死分支**

`chat_service.py`：把过期报错文案"target_type 仅支持 employee、group 或 curator。"改为"target_type 仅支持 employee 或 curator。"。
检查 `if target_type == "group": raise ...("群组功能已下线")` 分支：收窄 Literal 后，若该 target_type 经 pydantic 校验则 `"group"` 已在入口被拒，此分支不可达 → 删除该分支；若该处 target_type 是未经校验的裸 str，则保留运行时 guard（按实际调用链判定，prefer 删除不可达分支）。

- [ ] **Step 5: 后端基线**

Run: `cd apps/server && uv run pytest -q 2>&1 | tail -3`
Expected: failed 数 ≤ 基线（约 5）。若有 group/is_group 相关测试因语义变更失败 → 按"group 退场"更新断言（删对应用例或改期望），不得掩盖真实回归。

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/schemas/conversation.py apps/server/src/schemas/recent_contact.py apps/server/src/service/recent_contact_service.py apps/server/src/service/chat_service.py
git commit -m "refactor(contact): TargetType 收窄去 group + 去重 + 删恒假 is_group + 修过期文案"
```

---

### Task 5: 集成收尾 — 全量基线 + 残留 grep

- [ ] **Step 1: 全量基线三连**

Run:
```bash
cd apps/server && uv run pytest -q 2>&1 | tail -3
cd ../web && npx tsc -p tsconfig.app.json --noEmit 2>&1 | rg -c 'error'
npx vitest run 2>&1 | tail -5
```
Expected: 三者 failed/error 数均 ≤ 各自基线，无新增。

- [ ] **Step 2: 残留 grep（确认 group/sender 契约层清干净）**

Run:
```bash
cd apps/server && rg -n 'is_group|sender_label|sender_id' src/schemas/ src/service/recent_contact_service.py
cd ../web && rg -n 'GroupMembersAvatar|isGroupTimelineMessage|senderName|senderId|ContactType.*group|sender_label' src/
```
Expected: 仅剩**有意保留**项（后端 `models/conversation.py` 的 DB 列、`init_db` 建列、`chunk_json/stream_chunks`——这些是留给独立迁移 PR 的，不在本期）。其余应为零。列出剩余项确认都是"DB 列待迁移"类。

- [ ] **Step 3: 不删项备忘**

确认以下**故意保留**（独立不可逆迁移 PR）：
- `apps/server/src/models/conversation.py`：`sender_id`/`sender_label`/`chunk_json` 列
- `apps/server/src/db/init_db.py`：上述列 + `stream_chunks` 建表语句

无需 commit（仅核对）。若 Task 1-4 commit 齐全则本任务无产物。
