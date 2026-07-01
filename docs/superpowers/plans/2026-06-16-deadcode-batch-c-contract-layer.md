# 死代码清理 Batch C —— 契约层（暂缓，待前后端协同）

> 背景：阶段4「总管中心化」群退场 + 员工单聊退场后，Batch A（零风险孤儿/恒空）
> 与 Batch B（低风险逻辑 + 测试）已于 commit `2ffae184` 清理完成。
> 本文档记录**剩余的契约层死代码**——它们当前都是 inert（不可达但无害），
> 删除需要**前端类型与后端 DTO 同步修改**，部分涉及**不可逆的 DB 删列迁移**，
> 故单独一趟谨慎做，不与 A/B 混在一起。
>
> 排查来源：两个 Explore subagent（前端 + 后端）+ 人工 grep 复核（2026-06-16）。
> 行号为排查时快照，动手前需重新定位。

## 为什么是「契约层」而非直接删

后端对外 DTO / API enum 仍保留 group 概念（`target_type="group"` 现由
`chat_service` 直接返回 400 拒绝，`is_group` 字段恒返回 False）。前端类型必须
与后端 DTO 对齐——只删前端类型会导致与后端响应不匹配；只删后端字段会让旧前端
解析失败。因此 C 必须**前后端成对改**，且 DB 删列不可逆，要确认所有部署已过渡。

---

## C-1 前端：ContactType "group" + Contact.group + 全部消费死分支

`fetchContacts()`（`apps/web/src/api/chat.ts`）已只产出 curator/employee 两类 Contact，
永不产生 `type:"group"`，故下列分支全为死路径：

- `apps/web/src/types/chat.ts`
  - `ContactType = "curator" | "employee" | "group"` → 去 `"group"`
  - `Contact.group?: { id; name; participants }` 字段 → 删
- 消费侧死分支（`contact.type === "group"` 永假）：
  - `apps/web/src/lib/chat/contact-utils.ts`（约 L16/39/46）
  - `apps/web/src/lib/chat/contact-target.ts`（约 L18-20）
  - `apps/web/src/components/chat/conversations/recent-conversations/model.ts`（约 L12/37/65-68/82-89/96-99，含 `isGroup` 推导、`contact.group.participants`）
  - `apps/web/src/components/chat/conversations/recent-conversations/persistence.ts`（约 L101）
  - `apps/web/src/hooks/use-chat-queries.ts`（约 L156）

**前置依赖**：需先确认后端 `ChatTargetType`/`is_group`（见 C-4）也清，否则前端
类型与 DTO 失配。

## C-2 前端：GroupMembersAvatar + isGroup 渲染分支

- `apps/web/src/components/chat/contacts/contact-avatars.tsx`：`GroupMembersAvatar` 组件本体（约 L60-109）
- `apps/web/src/components/chat/contact-avatars.tsx`：该组件的 re-export
- `apps/web/src/components/chat/conversations/recent-conversations/recent-conversation-row.tsx`：`item.isGroup ? <GroupMembersAvatar/> : <EmployeeContactAvatar/>`（约 L163-173）
- `recent-conversations/types.ts`：`isGroup?: boolean` 字段（随 C-1/C-4 一起去）

`isGroup` 恒为 false（后端不再返回 group 类型 contact），整条群头像渲染链是死分支。

## C-3 前端：群时间线消息（sender/合并）

- `apps/web/src/lib/chat/merge-consecutive-assistant-messages.ts`：
  `isGroupTimelineMessage()`（约 L49-51）+ 调用点（约 L107）+ `AssistantMeta.senderName/senderId`（约 L14-15）
- `apps/web/src/lib/chat/message-utils.ts`（约 L76-77）、`chat-mappers.ts`（约 L23-25）：
  从 DTO 的 `sender_id/sender_label` 写入 `senderName/senderId`

**风险点**：需确认**没有任何会话类型**（含总管编排子任务）会产生非空
`sender_label`。若总管编排仍用它标注子任务发送者，则不能删——这是 C 里最需要
核实的一项。

## C-4 后端：对外 DTO / enum / DB 列

- `apps/server/src/schemas/conversation.py` & `schemas/recent_contact.py`：
  `TargetType = Literal["employee", "group", "curator"]` → 去 `"group"`
  （`chat_service` 已对 group 返回 400；确认前端不再传 group 后可删）
- `apps/server/src/schemas/recent_contact.py`（约 L41）+ `service/recent_contact_service.py`（约 L135-136/149/177）：
  `is_group` 字段恒 False + 群 fallback 死分支 → 删（**对外 JSON 字段，需前端同步**）
- `apps/server/src/models/conversation.py`（约 L43-45）+ `schemas/conversation.py`（约 L65-66）+ `db/init_db.py`（约 L176-180）：
  `sender_id` / `sender_label`（仅群时间线用，从未写入）→ DTO 可先删，**DB 删列需迁移、不可逆**
- `apps/server/src/db/init_db.py`（约 L172-173）+ `models/conversation.py`（约 L38）+ `schemas/conversation.py`（约 L60）：
  旧 `stream_chunks` 列（`extract_message_parts` 已在 Batch A 删，零写入）、
  `chunk_json`（已标 Deprecated）→ 与 C-3/技术债一起清

---

## 建议执行顺序（成对改，逐步验证）

1. **先核实 C-3 的 `sender_label`**：grep 后端所有写入路径，确认总管编排不依赖它。
   这是决定 sender 字段能否删的关键。
2. **DTO 字段对（不删 DB 列）**：同一 PR 内删后端 `is_group`/`sender_*` DTO 字段
   + 前端对应类型与消费分支（C-1/C-2/C-3 前端部分）。前端深 typecheck
   （`cd apps/web && npx tsc -p tsconfig.app.json`）错误驱动逐个清。
3. **enum 收窄**：确认前端零处再传 `target_type:"group"` 后，去后端两个
   `TargetType` 的 `"group"` + 前端 `ChatTargetType`/`ContactType` 的 `"group"`。
4. **DB 删列（最后，单独 PR）**：`sender_id`/`sender_label`/`stream_chunks` 删列迁移，
   确认所有部署已过渡后再做（不可逆）。

## 验证基线（每步必过）

- 后端：`cd apps/server && uv run pytest -q` —— 已知基线 5 个失败
  （test_agent_runtime_policy×2 / test_orchestrator_execution_summary /
  test_shell_error_steering×2），不得新增。
- 前端真实 typecheck：`cd apps/web && npx tsc -p tsconfig.app.json --noEmit`
  —— 基线 90 错，与提交前 diff 错误签名判断有无新增（**不是** `pnpm typecheck`，
  那是浅检不查 app 源码）。
- 前端：`cd apps/web && npx vitest run` —— 已知基线 1 个失败
  （resolve-workbench-curator-panel），不得新增。
