# HITL 测试场景手册

本文供 **手工测试 / QA** 使用，覆盖「废弃 `interrupt_payload` + 展示层 input 合并」改造后的 HITL 全场景。

架构背景见 [hitl-architecture.md](./hitl-architecture.md)。夹具示例见 [hitl_chunks.json](./hitl_chunks.json)、[`apps/web/src/lib/chat/__fixtures__/hitl/chunks_hitl.json`](../../web/src/lib/chat/__fixtures__/hitl/chunks_hitl.json)。

---

## 一、测试前准备

### 1.1 环境

| 项 | 要求 |
| --- | --- |
| 前端 | `pnpm dev` 或 `pnpm --filter digital-employee dev:app` |
| 后端 | `pnpm dev:server` 或 `apps/server` 下 `uv run python start.py` |
| LLM | 设置页已接入供应商且存在 active 模型（`LLM_REGISTRY`） |
| 员工技能 | 被测员工需具备 **长文档写作** 类技能（会触发 `submit_clarifying_questions`、`submit_document_plan`） |

### 1.2 推荐触发语

在员工单聊 / 总管 / 新对话中发送：

```text
帮我写个文档
```

或：

```text
帮我写一份技术方案
```

### 1.3 观察要点（通用）

测试时除 UI 外，建议打开 DevTools → Network，必要时查看消息列表 API 返回的 `message_parts`。

| 观察面 | 正常表现 |
| --- | --- |
| **Composer** | interrupt 期间输入框占位为「请先确认或中止当前待办」或澄清可选补充；澄清时底部 **Dock** 出现 |
| **审批** | approve 后流继续，不出现重复 Dock / 重复待确认方案卡 |
| **历史气泡** | 同一 user 提问内，多条 assistant DB 行在 UI 上 **合并为一条气泡** |
| **澄清 Answers** | 已提交后显示题目 + 答案，**不是** 全部「（未填写）」 |
| **方案卡** | 待确认：有「开始写作 / 修改大纲 / 退回修改」；**已确认且刷新后**：只读，**无** 操作按钮 |
| **DB** | 新 interrupt 行的 `message_parts` 含 `input-available` pending part；**不再**依赖 `extra_meta.interrupt_payload` |

### 1.4 日志与排查

| 文件 | 用途 |
| --- | --- |
| `~/.digital-employee/logs/app.log` | 后端 interrupt flush、approve |
| `~/.digital-employee/logs/main.log` | Electron 主进程 |

异常对照 [hitl-architecture.md §九 排查清单](./hitl-architecture.md#九排查清单)。

---

## 二、场景优先级说明

| 级别 | 说明 | 发版要求 |
| --- | --- | --- |
| **P0** | 主路径 + 刷新一致性 | 每次发版必跑 |
| **P1** | 分支操作（Skip / Edit / Reject）与恢复 | 改动 HITL 相关代码时必跑 |
| **P2** | 兼容边界、多入口、异常态 | 大版本或数据迁移前跑 |

---

## 三、P0 — 主路径（必跑）

### P0-1 员工单聊 · 澄清 → 方案 · live

**入口**：员工单聊 `ConversationChatView`

| 步骤 | 操作 | 预期 |
| --- | --- | --- |
| 1 | 发送「帮我写个文档」 | 助手回复并开始流式输出 |
| 2 | 等待 interrupt | 底部出现 **澄清 Dock**；Composer 不可正常发消息 |
| 3 | 在 Dock 中选择/填写各题，点击提交 | Dock 消失；流 resume；**不**报错 |
| 4 | 等待第二次 interrupt | 气泡内出现 **长文档方案待确认** 卡片（含大纲） |
| 5 | 点击「开始写作」 | 卡片变为已确认；助手继续写作 |
| 6 | 观察同轮 UI | 同一 assistant 气泡内：文案 → **Answers** → 方案 → 后续正文（非多条独立 assistant 气泡） |

---

### P0-2 员工单聊 · 刷新后历史一致

**前置**：完成 P0-1 或进行至至少「澄清已提交」

| 步骤 | 操作 | 预期 |
| --- | --- | --- |
| 1 | 在澄清已提交、方案待确认或方案已确认任一时刻 **F5 刷新** | 页面恢复，无白屏 |
| 2 | 查看澄清 Answers 块 | 每题有对应答案，**非** 全部「（未填写）」 |
| 3 | 若方案已确认，查看方案区域 | 显示大纲 / 「文档方案已确认」，**无** 「开始写作」等按钮 |
| 4 | 若方案仍待确认 | 方案卡仍为待确认态，按钮可用；Composer 仍锁定 |
| 5 | （可选）Network 查看消息 API | 已 interrupt 行 `message_parts` 含 `tool-*` 的 `input-available`；已 approve 行有 `approved_at` |

---

### P0-3 新对话 Draft · 完整 HITL 一轮

**入口**：新对话 `DraftChatView`

| 步骤 | 操作 | 预期 |
| --- | --- | --- |
| 1 | 选择员工，新建对话，发送「帮我写个文档」 | 创建会话成功 |
| 2 | 重复 P0-1 步骤 2–6 | 与员工单聊行为一致 |
| 3 | 刷新 | 与 P0-2 一致 |

---

### P0-4 总管 Curator · HITL + 时间线

**入口**：总管助手 `CuratorView`

| 步骤 | 操作 | 预期 |
| --- | --- | --- |
| 1 | 在总管会话发送「帮我写个文档」（或触发总管亲自执行长文档任务的表述） | 进入 HITL |
| 2 | 完成澄清 + 方案确认 | 时间线内可见 Answers、方案卡；底部 Composer 行为与单聊一致 |
| 3 | 刷新 | 时间线历史与 P0-2 一致；底部 Dock / 锁定态正确 |

---

## 四、P1 — 分支与恢复

### P1-1 澄清 Skip（拒绝）

| 步骤 | 操作 | 预期 |
| --- | --- | --- |
| 1 | 触发澄清 interrupt | Dock 出现 |
| 2 | 点击 Skip / 跳过（若有）或通过 Dock 走 reject 决策 | 调用 `POST /approve` 成功，**非** `POST /stream/cancel` 400 |
| 3 | 观察 Composer | HITL 锁定解除，可继续输入 |
| 4 | 刷新 | 不出现异常 Dock；历史有跳过/拒绝类文案 |

---

### P1-2 方案 · 修改大纲（edit）后确认

| 步骤 | 操作 | 预期 |
| --- | --- | --- |
| 1 | 触发方案 interrupt | 方案卡待确认 |
| 2 | 点击「修改大纲」，改标题或章节，提交 | approve 成功，流继续 |
| 3 | 刷新 | 历史方案展示 **修改后** 的大纲（enrich 自 sealed 行 input） |

---

### P1-3 方案 · 退回修改（reject）

| 步骤 | 操作 | 预期 |
| --- | --- | --- |
| 1 | 触发方案 interrupt | 方案卡待确认 |
| 2 | 点击「退回修改」，填写意见并提交 | approve(reject) 成功 |
| 3 | 观察 UI | 方案卡呈中止/退回态，无 pending 按钮 |
| 4 | 刷新 | 状态保持，Composer 不误锁 |

---

### P1-4 interrupt 后立即刷新（未 approve）

| 步骤 | 操作 | 预期 |
| --- | --- | --- |
| 1 | 触发澄清或方案 interrupt | Dock 或方案卡出现 |
| 2 | **不要** 点提交，直接 F5 | 刷新后 Dock / 待确认方案卡 **仍可见** |
| 3 | 完成 approve | 与 P0 一致，流正常 resume |

---

### P1-5 approve 后立即刷新

| 步骤 | 操作 | 预期 |
| --- | --- | --- |
| 1 | 澄清或方案刚提交成功、流尚未结束 | — |
| 2 | 立即 F5 | 无 **重复** Dock；无 **重复** 待确认方案按钮 |
| 3 | Composer | 若仍有下一 pending 则锁定，否则可输入 |

---

### P1-6 断线 / 关页后再开（可选）

| 步骤 | 操作 | 预期 |
| --- | --- | --- |
| 1 | 流式进行中或 interrupted 态 | — |
| 2 | 关闭窗口再打开同会话 | hydrate 后 UI 与 DB 一致；`tryResumeOnce` 对 streaming 行可 resume |

---

## 五、P2 — 边界与兼容

### P2-1 旧数据硬切（不兼容）

**前置**：升级前产生的、仅含 `extra_meta.interrupt_payload`、**无** pending `message_parts` 的历史会话

| 步骤 | 操作 | 预期 |
| --- | --- | --- |
| 1 | 打开该历史会话 | **已知**：Dock / 待确认方案 **可能无法恢复** |
| 2 | 记录 | 产品预期为硬切；新 interrupt 起生效 |

---

### P2-2 仅澄清、未到方案门

| 步骤 | 操作 | 预期 |
| --- | --- | --- |
| 1 | 触发澄清并提交 | Answers 正确 |
| 2 | 在助手尚未调用 `submit_document_plan` 前刷新 | 无方案卡；Answers 仍正确 |

---

### P2-3 方案确认后继续写作再刷新

**前置**：方案已 confirm，助手已 write_file 等（如会话 #124 形态）

| 步骤 | 操作 | 预期 |
| --- | --- | --- |
| 1 | 完成方案确认并等待部分章节输出 | 气泡内有正文 / 文件变更 |
| 2 | F5 | 方案仍只读；Answers 仍完整；不出现方案操作按钮 |

---

### P2-4 群聊 HITL（若技能已启用）

| 步骤 | 操作 | 预期 |
| --- | --- | --- |
| 1 | 在群聊 @ 员工并触发长文档任务 | 行为与员工单聊 P0 一致 |

---

### P2-5 context 变体（general / long_document）

| 步骤 | 操作 | 预期 |
| --- | --- | --- |
| 1 | 分别触发 general 与 long_document 上下文澄清 | Answers 标题文案可不同（「用户对问题的回答」vs「用户对长文档澄清问题的回答」） |
| 2 | 刷新 | 两种 context 下 Answers 均能解析出答案 |

---

## 六、API / 数据核对（可选，供开发联调）

在 Network 或 DB 中抽查 **新产生** 的 interrupt 行：

```json
{
  "stream_state": "interrupted",
  "message_parts": [
    { "type": "text", "text": "...", "state": "done" },
    {
      "type": "tool-submit_clarifying_questions",
      "toolCallId": "call_...",
      "state": "input-available",
      "input": { "context": "...", "questions": "[...]" }
    }
  ],
  "extra_meta": {
    "approved_at": null
  }
}
```

SSE interrupt 终态应为：

```json
{
  "status": "interrupted",
  "message_id": 672,
  "message_parts": [ "..."]
}
```

**不应**再依赖响应中的 `interrupt_payload` / `action_requests` 驱动前端。

approve 请求体：

```json
POST /chat/conversations/{id}/approve
{ "message_id": <interrupted 行 id>, "decisions": [...] }
```

`message_id` 必须为 **未 merge** 列表里 `findPendingHitl` 指向的那一行（通常为 `stream_state=interrupted` 且尚无 `approved_at` 的行）。

---

## 七、测试结果记录模板

复制下表填写每轮测试：

| 场景 ID | 入口 | 通过 | 备注 / Bug ID |
| --- | --- | --- | --- |
| P0-1 | 员工单聊 | ☐ | |
| P0-2 | 员工单聊刷新 | ☐ | |
| P0-3 | Draft | ☐ | |
| P0-4 | Curator | ☐ | |
| P1-1 | Skip | ☐ | |
| P1-2 | Edit 方案 | ☐ | |
| P1-3 | Reject 方案 | ☐ | |
| P1-4 | interrupt 后刷新 | ☐ | |
| P1-5 | approve 后刷新 | ☐ | |
| P1-6 | 断线恢复 | ☐ | |
| P2-1 | 旧数据 | ☐ | |
| P2-2 | 仅澄清 | ☐ | |
| P2-3 | 写作中刷新 | ☐ | |
| P2-4 | 群聊 | ☐ | |
| P2-5 | context 变体 | ☐ | |

---

## 八、修订记录

| 日期 | 说明 |
| --- | --- |
| 2026-05-25 | 初版：覆盖 message_parts HITL 改造后 P0/P1/P2 手工测试场景 |
