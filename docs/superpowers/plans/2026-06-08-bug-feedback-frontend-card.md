# BUG 反馈前端确认卡 + 截图 实现计划

**Goal:** 让 `submit_bug_report` 的 HITL 确认在前端渲染成一张可编辑「BUG 反馈表单卡」，支持选图/粘贴截图，确认后随表单一起提交到远端。

**Architecture:** 后端打开 HITL 白名单 + 工具加 `screenshot` 字段；前端仿 `submit_document_plan` 整套 HITL 卡链路（constants → kind → ClassifiedBlock → handler → registry → render-map → 新卡组件）。截图在卡片里读成 base64 dataURI 塞进 `edit` 决策的 args，随 payload 发远端，不走 /uploads 暂存。

**分支:** `feat/bug-feedback-employee`（在已完成的后端基础上扩展）。

---

## 后端（2 文件，TDD）

### B1. 打开 HITL 白名单（让确认卡能渲染）
- Modify `apps/server/src/service/hitl_pending_parts.py:14` — `HITL_TOOL_NAMES` 加入 `"submit_bug_report"`。
- 这是关键：否则 `build_pending_hitl_parts` 跳过它、前端拿不到 `tool-submit_bug_report` 待确认 part。

### B2. 工具加 `screenshot` 字段
- Modify `apps/server/src/service/agent/bug_report_tool.py` — `submit_bug_report` 增参数 `screenshot: str = ""`；非空时 `payload["screenshot"] = screenshot`。
- 测试 `apps/server/tests/test_bug_report_tool.py` 增：传 `screenshot="data:image/png;base64,AAA"` → `sf.call_args[0][0]["screenshot"]` 等于该值；不传则 payload 无 `screenshot` 键。
- 同时加一条断言：`"submit_bug_report" in HITL_TOOL_NAMES`（import 自 hitl_pending_parts）。

验证：`cd apps/server && uv run pytest tests/test_bug_report_tool.py -q`

---

## 前端（仿 document-plan 全链路）

参照物（逐一对照仿写）：
- `apps/web/src/lib/chat/hitl/constants.ts`（`DOCUMENT_PLAN_TOOL_NAME` + part-type 数组）
- `apps/web/src/lib/chat/hitl/kind.ts`（`PendingHitlKind` + `hitlKindFromToolType`）
- `apps/web/src/lib/chat/message-classifier.ts`（`ClassifiedBlock` 联合类型，document-plan 成员在 ~L207）
- `apps/web/src/lib/chat/tools/handlers/document-plan.ts` + `tools/block-registry.ts`
- `apps/web/src/components/chat/message-blocks/block-render-map.tsx`（L182 document-plan 分支）
- `apps/web/src/components/chat/message-blocks/document-plan-card.tsx`（卡片样板，含 view/edit/reject + approveHitl）

### F1. 常量
- `hitl/constants.ts`：加 `export const BUG_REPORT_TOOL_NAME = "submit_bug_report"`；把 `tool-${BUG_REPORT_TOOL_NAME}` 加入该文件里列举 HITL part-type 的数组/导出（与 clarify/document_plan 并列）。

### F2. kind 映射
- `hitl/kind.ts`：`PendingHitlKind` 增 `"bug-report"`；函数加 `if (type === \`tool-${BUG_REPORT_TOOL_NAME}\`) return "bug-report"`。

### F3. ClassifiedBlock 类型
- `message-classifier.ts`：联合类型增成员
  `{ kind: "bug-report"; key: string; toolCallId: string; input: unknown; state: string; resultText: string | null }`。

### F4. handler
- 新建 `tools/handlers/bug-report.ts`：仿 `document-plan.ts`，`match: vm.toolName === BUG_REPORT_TOOL_NAME`，`classify` 返回 `kind:"bug-report"`（input/state/resultText；不需要单独的 approved-summary 分支，output-available 时同卡显示已提交，参照 destructive-delete 的处理）。
- `tools/block-registry.ts`：import 并把 `bugReportHandler` 加进 `TOOL_BLOCK_HANDLERS`。

### F5. 卡片组件
- 新建 `components/chat/message-blocks/bug-report-card.tsx`：仿 `DocumentPlanCard`：
  - 字段（view 展示 / edit 可改）：标题 title、描述 description、复现 repro_steps、期望 expected、实际 actual、附日志开关 include_logs。
  - **截图**：edit 模式下一个图片选择 + 粘贴区；选图后 `FileReader.readAsDataURL` 读成 base64 dataURI，存 state，缩略图预览，可移除。建议限制大小（如 ≤2MB，超限 toast）。
  - 按钮：「确认提交」「修改」「退回」。
    - 有截图或改过字段 → `submitDecisions([{ type:"edit", edited_action:{ name:"submit_bug_report", args:{ title, description, repro_steps, expected, actual, include_logs, screenshot } } }])`。
    - 原样 → `[{ type:"approve" }]`；退回 → `[{ type:"reject", message }]`。
  - 复用 `approveHitl`、`isValidApproveMessageId`、`onHitlApproved`（`kind:"bug-report"`）、`isHitlAbortedOutput`，与 DocumentPlanCard 同。
  - state 语义同：`input-available`=待确认显按钮，`output-available`=已提交。

### F6. 渲染映射
- `block-render-map.tsx`：加
  ```tsx
  if (block.kind === "bug-report") {
    return <BugReportCard key={block.key} input={block.input} state={block.state}
      resultText={block.resultText} conversationId={conversationId} messageId={messageId}
      toolCallId={block.toolCallId} onHitlApproved={onHitlApproved} className="w-full" />
  }
  ```

### F7. 校验
- `cd apps/web && pnpm typecheck` 通过。
- 若 `hitl/kind.ts` / handler 有对应单测目录，补最小单测：`hitlKindFromToolType("tool-submit_bug_report") === "bug-report"`；`bugReportHandler.classify` 返回 `kind:"bug-report"`。
- `pnpm lint --filter` 相关文件无新错。

---

## 注意 / 取舍
- 截图走 base64-in-args：单张、限大小；多张/大图留后续（YAGNI）。base64 会进 HITL resume args 与 checkpoint，单张可接受。
- collapse-document-plan-blocks 那类流式合并对 bug-report 非必需（MVP 跳过；若出现输入流式期重复卡再补）。
- 远端 multipart/字段名未定：本期 `screenshot` 作为 payload 内一个 base64 字段随 JSON 发出，远端定稿后再调。

## 待远端
- 截图字段名 / 是否要 multipart / 大小上限。
