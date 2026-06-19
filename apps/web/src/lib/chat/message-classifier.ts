import type { UIMessage } from "ai"

import {
  resolveUserMessageDisplay,
  type ToolUiActionKind,
} from "./tool-ui-action"

/** 流式错误事件注入 text part 时的前缀标记 */
export const ERROR_MARKER = "⚠️ERROR:"

function isErrorText(text: string): boolean {
  return text.startsWith(ERROR_MARKER)
}

function stripErrorMarker(text: string): string {
  return text.slice(ERROR_MARKER.length).trim()
}

/** 将常见英文网络/工具错误转为中文展示 */
export function localizeErrorMessage(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) return trimmed
  const lower = trimmed.toLowerCase()
  if (lower.includes("tool result too large")) {
    return (
      "工具返回内容过大，已写入内部缓存。请缩小查询范围" +
      "（例如只查单个员工），或直接用 update_employee 传入 skill_ids。"
    )
  }
  if (lower.includes("connection error")) {
    return "无法连接当前语言模型，请检查设置中的 API Key、Base URL 与模型名称。"
  }
  if (lower.includes("server disconnected without sending a response")) {
    return "远程服务未响应（连接已断开），请稍后重试。"
  }
  if (lower.includes("timed out") || lower.includes("timeout")) {
    return "远程服务请求超时，请稍后重试。"
  }
  if (lower.includes("connection refused") || lower.includes("connect error")) {
    return "无法连接远程服务，请检查网络与模型配置。"
  }
  if (lower.includes("network error") || lower.includes("failed to fetch")) {
    return "网络请求失败，请检查网络连接。"
  }
  if (trimmed.startsWith("错误：") || trimmed.startsWith("错误:")) {
    return trimmed
  }
  if (trimmed.startsWith("无法连接当前语言模型")) {
    return trimmed
  }
  return trimmed
}

export function formatErrorDisplayText(text: string): string {
  const raw = isErrorText(text) ? stripErrorMarker(text) : text
  return localizeErrorMessage(raw)
}

import {
  isSkillToolCall,
  extractSkillName,
} from "./tool-summarizer"
import {
  getFileChangesFromUIMessage,
  type FileChangeItem,
} from "./file-change-utils"
import { isSummarizationTextPart } from "./langchain-summarization-text"
import { collapseWriteTodosBlocks } from "./collapse-write-todos-blocks"
import { collapseDocumentPlanBlocks } from "./hitl/collapse-document-plan-blocks"
import { mergeRoutineToolGroups } from "./merge-routine-tool-groups"
import type { TodoItem } from "@/components/chat/message-blocks/tool-shared"
import { getMessageMetadataRecord } from "@/components/chat/shared/chat-view-shared"
import { normalizeToolPart } from "./tools/normalize-tool-part"
import { isToolUIPart } from "./tools/tool-part"
import type { ToolViewModel } from "./tools/tool-view-model"
import { getToolBlockFromRegistry } from "./tools/block-registry"
import type { ClarifyAnswerItem } from "./hitl"

export type ToolGroupItem = ToolViewModel & {
  key: string
}

export interface SkillExploreItem {
  key: string
  toolCallId: string
  toolName: string
  state: string
  label: string
  skillName: string | null
  input: unknown
  resultText: string | null
}

export type ClassifiedBlock =
  | { kind: "thinking"; key: string; text: string }
  | {
      kind: "member-milestone"
      key: string
      senderName: string
      milestoneKind: "accepted" | "progress" | "delivered" | "failed" | "cancelled"
      text: string
      artifacts?: string[]
    }
  | { kind: "tool-group"; key: string; tools: ToolGroupItem[]; summary: string }
  | {
      kind: "todo-plan"
      key: string
      tool: ToolGroupItem
      todos: TodoItem[]
    }
  | {
      kind: "skill-exploration"
      key: string
      items: SkillExploreItem[]
      thinkingText?: string
    }
  | {
      kind: "plan-generated"
      key: string
      toolCallId: string
      input: unknown
      state: string
      resultText: string | null
    }
  | {
      kind: "workbench-arrange"
      key: string
      toolCallId?: string
      operations: import("@/types/workbench").WorkbenchArrangeOp[]
      summary: string
    }
  | {
      kind: "recruitment-candidates"
      key: string
      toolCallId: string
      state: string
      resultText: string | null
      preliminary?: boolean
    }
  | {
      kind: "employee-hired"
      key: string
      toolCallId: string
      state: string
      resultText: string | null
      preliminary?: boolean
    }
  | {
      kind: "employees-hired"
      key: string
      toolCallId: string
      state: string
      resultText: string | null
      preliminary?: boolean
    }
  | {
      kind: "group-created"
      key: string
      toolCallId: string
      state: string
      resultText: string | null
      preliminary?: boolean
    }
  | {
      kind: "employee-detail"
      key: string
      toolCallId: string
      state: string
      resultText: string | null
      preliminary?: boolean
    }
  | {
      kind: "employee-updated"
      key: string
      toolCallId: string
      state: string
      resultText: string | null
      preliminary?: boolean
    }
  | {
      kind: "employee-deleted"
      key: string
      toolCallId: string
      state: string
      resultText: string | null
      preliminary?: boolean
    }
  | {
      kind: "tasks-deleted"
      key: string
      toolCallId: string
      state: string
      resultText: string | null
      preliminary?: boolean
    }
  | {
      kind: "employees-dismissed"
      key: string
      toolCallId: string
      state: string
      resultText: string | null
      preliminary?: boolean
    }
  | {
      kind: "destructive-delete"
      key: string
      toolCallId: string
      toolName: string
      state: string
      input: unknown
      resultText: string | null
    }
  | { kind: "summarization-checkpoint"; key: string; text: string }
  | {
      kind: "user-action-summary"
      key: string
      text: string
      uiAction?: ToolUiActionKind
    }
  | { kind: "final-response"; key: string; text: string }
  | { kind: "file-changes"; key: string; files: FileChangeItem[] }
  | {
      kind: "draft-skill-save"
      key: string
      skillName: string
      skillPath: string
    }
  | { kind: "error"; key: string; text: string }
  | {
      kind: "document-plan"
      key: string
      toolCallId: string
      input: unknown
      state: string
      resultText: string | null
    }
  | {
      kind: "bug-report"
      key: string
      toolCallId: string
      input: unknown
      state: string
      resultText: string | null
    }
  | {
      kind: "clarifying-answers"
      key: string
      toolCallId: string
      items: ClarifyAnswerItem[]
      /** tool part 为 output-error，与正常作答区分 */
      outputError?: boolean
    }
  | {
      kind: "document-plan-approved"
      key: string
      toolCallId: string
      resultText: string
    }
  | {
      kind: "orchestrator-task-summary"
      key: string
      heading: string
      body: string
      runStatus: string | null
      employeeConversationId: number | null
      taskId: number | null
    }

interface ClassifyMessagePartsOptions {
  includeFileChanges?: boolean
}

const THINK_OPEN_RE = /^<think\s*>?\n?/s
const THINK_CLOSE_RE = /\n?\s*<\/think\s*>?\n?/s
const THINK_BLOCK_RE = /<think\s*>?[\s\S]*?<\/think\s*>?\n?/g

function stripThinkTags(text: string): string {
  return text.replace(THINK_OPEN_RE, "").replace(THINK_CLOSE_RE, "").trim()
}

function stripThinkSections(text: string): string {
  return text.replace(THINK_BLOCK_RE, "").trim()
}

function mergeSummarizationCheckpointBlock(
  blocks: ClassifiedBlock[],
  messageId: string,
  partIndex: number,
  rawText: string
) {
  const text = stripThinkSections(rawText)
  if (!text.trim()) return

  const last = blocks[blocks.length - 1]
  if (last?.kind === "summarization-checkpoint") {
    last.text += (last.text.trim() ? "\n" : "") + text
    return
  }

  blocks.push({
    kind: "summarization-checkpoint",
    key: `${messageId}:summarization:${partIndex}`,
    text,
  })
}

function extractOrchestratorTaskSummary(
  message: UIMessage
): ClassifiedBlock | null {
  const meta = (message as unknown as { metadata?: unknown }).metadata
  if (!meta || typeof meta !== "object") return null
  const m = meta as Record<string, unknown>
  if (m.source !== "orchestrator_execution_summary") return null

  let rawText = ""
  for (const p of message.parts) {
    if (p.type === "text" && "text" in p && typeof p.text === "string") {
      rawText += p.text
    }
  }
  rawText = rawText.trim()
  if (!rawText && typeof (message as unknown as { content?: unknown }).content === "string") {
    rawText = ((message as unknown as { content?: string }).content ?? "").trim()
  }
  if (!rawText) return null

  const firstLineBreak = rawText.indexOf("\n")
  const heading = (firstLineBreak === -1 ? rawText : rawText.slice(0, firstLineBreak)).trim()
  const body = (firstLineBreak === -1 ? "" : rawText.slice(firstLineBreak + 1))
    .replace(/\n*可点击下方卡片进入员工对话查看详情。\s*$/u, "")
    .trim()

  const runStatus = typeof m.run_status === "string" ? m.run_status : null
  const employeeConversationId =
    typeof m.employee_conversation_id === "number"
      ? m.employee_conversation_id
      : null
  const taskId = typeof m.task_id === "number" ? m.task_id : null

  return {
    kind: "orchestrator-task-summary",
    key: `${message.id}:orch-summary`,
    heading,
    body,
    runStatus,
    employeeConversationId,
    taskId,
  }
}

/**
 * 将 UI 消息的部分内容分类为不同的块（思考过程、工具调用组、最终响应）。
 *
 * 该函数根据消息中是否包含工具调用以及文本部分相对于最后一个工具调用的位置，
 * 将消息拆分为具有特定语义的块。
 *
 * @param message - 需要分类的 UI 消息对象
 * @returns 分类后的块数组，包含思考块、工具组块和最终响应块
 */
export function classifyMessageParts(
  message: UIMessage,
  options: ClassifyMessagePartsOptions = {}
): ClassifiedBlock[] {
  const milestone = getMessageMetadataRecord(message)?.milestone as
    | { kind?: string; text?: string; artifacts?: string[] }
    | undefined
  if (milestone && typeof milestone.kind === "string") {
    const meta = getMessageMetadataRecord(message)
    const senderName =
      typeof meta?.senderName === "string" ? meta.senderName : "成员"
    return [
      {
        kind: "member-milestone",
        key: `${message.id}:milestone`,
        senderName,
        milestoneKind: milestone.kind as
          | "accepted"
          | "progress"
          | "delivered"
          | "failed"
          | "cancelled",
        text: typeof milestone.text === "string" ? milestone.text : "",
        artifacts: Array.isArray(milestone.artifacts)
          ? milestone.artifacts.filter((a): a is string => typeof a === "string")
          : undefined,
      },
    ]
  }

  const parts = message.parts
  if (parts.length === 0) return []

  if (message.role === "user") {
    const userAction = resolveUserMessageDisplay(message)
    if (userAction) {
      return [
        {
          kind: "user-action-summary",
          key: `${message.id}:user-action`,
          text: userAction.displayText,
          uiAction: userAction.uiAction,
        },
      ]
    }
  }

  const orchestratorSummary = extractOrchestratorTaskSummary(message)
  if (orchestratorSummary) {
    return [orchestratorSummary]
  }

  const hasAnyTool = parts.some(isToolUIPart)

  if (!hasAnyTool) {
    const out: ClassifiedBlock[] = []
    let responseAccum = ""

    for (let i = 0; i < parts.length; i++) {
      const p = parts[i]
      if (p.type !== "text" || !("text" in p) || !p.text) continue

      if (isSummarizationTextPart(p)) {
        if (responseAccum.trim()) {
          const c = stripThinkSections(responseAccum)
          if (c) {
            if (isErrorText(c)) {
              return [
                {
                  kind: "error",
                  key: `${message.id}:error:0`,
                  text: formatErrorDisplayText(c),
                },
              ]
            }
            out.push({
              kind: "final-response",
              key: `${message.id}:response:${out.length}`,
              text: c,
            })
          }
          responseAccum = ""
        }
        mergeSummarizationCheckpointBlock(out, message.id, i, p.text)
      } else {
        responseAccum += p.text
      }
    }

    if (responseAccum.trim()) {
      const c = stripThinkSections(responseAccum)
      if (c) {
        if (isErrorText(c)) {
          return [
            {
              kind: "error",
              key: `${message.id}:error:0`,
              text: formatErrorDisplayText(c),
            },
          ]
        }
        out.push({
          kind: "final-response",
          key: `${message.id}:response:final`,
          text: c,
        })
      }
    }

    return out
  }

  const lastToolIndex = parts.reduce(
    (acc, p, i) => (isToolUIPart(p) ? i : acc),
    -1
  )

  const blocks: ClassifiedBlock[] = []

  /**
   * 将单个工具调用部分转换为工具组块并添加到结果列表中
   *
   @param part - 工具调用部分
   * @param index - 该部分在消息部分数组中的索引
   */
  function pushSingleTool(part: UIMessage["parts"][number], index: number) {
    if (!isToolUIPart(part)) return
    const vm = normalizeToolPart(part)

    const registryBlock = getToolBlockFromRegistry(vm, message.id, index)
    if (registryBlock) {
      if (Array.isArray(registryBlock)) {
        blocks.push(...registryBlock)
      } else {
        blocks.push(registryBlock)
      }
      return
    }

    // 检查当前工具调用是否属于技能类工具，如果是则构建并添加技能探索项
    if (isSkillToolCall(vm.input, vm.toolName)) {
      // 提取技能名称
      const skillName = extractSkillName(vm.input, vm.toolName)
      // 根据技能名称和文件路径生成显示用的基础名称
      const basename = skillName
        ? `${skillName}/${vm.summary.filePath?.split("/").pop() ?? ""}`
        : (vm.summary.filePath?.split("/").pop() ?? vm.toolName)

      // 构造技能探索项并加入列表，随后终止当前处理流程
      skillExploreItems.push({
        key: `${message.id}:skill-explore:${vm.toolCallId}:${index}`,
        toolCallId: vm.toolCallId,
        toolName: vm.toolName,
        state: vm.state,
        label: `${SKILL_EXPLORE_VERB[vm.toolName] ?? "读取"} ${basename}`,
        skillName,
        input: vm.input,
        resultText: vm.resultText,
      })
      return
    }

    const tool: ToolGroupItem = {
      ...vm,
      key: `${message.id}:tool:${vm.toolCallId}:${index}`,
    }

    blocks.push({
      kind: "tool-group",
      key: `${message.id}:tgroup:${index}`,
      tools: [tool],
      summary: vm.summary.label,
    })
  }

  /**
   * 刷新技能探索状态，将收集到的探索项打包成块并重置相关状态。
   * 仅在触发原因为 "tool" 或 "end" 且存在待处理探索项时执行提交操作。
   *
   * @param reason - 触发刷新的原因，可选值为 "tool"、"text" 或 "end"
   */
  function flushSkillExplore(reason: "tool" | "text" | "end") {
    if (skillExploreItems.length === 0) return

    // 当触发原因为工具调用或结束时，将当前积累的探索项封装为数据块并清空临时状态
    if (reason === "tool" || reason === "end") {
      blocks.push({
        kind: "skill-exploration",
        key: `${message.id}:skill-explore:${skillExploreItems[0].key}`,
        items: [...skillExploreItems],
        thinkingText: skillThinkingText || undefined,
      })
      skillExploreItems.length = 0
      skillThinkingText = ""
      skillExploreOpen = false
    }
  }

  const SKILL_EXPLORE_VERB: Record<string, string> = {
    read_file: "读取",
    ls: "浏览",
    glob: "搜索",
    grep: "搜索",
  }

  const skillExploreItems: SkillExploreItem[] = []
  let skillThinkingText = ""
  let skillExploreOpen = false
  let responseText = ""

  // 遍历消息的各个部分，根据类型将其分类为最终响应、思考过程或工具调用
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]

    // 处理文本类型的部分：区分最终响应和思考内容
    if (part.type === "text" && "text" in part && part.text) {
      if (isSummarizationTextPart(part)) {
        flushSkillExplore("end")
        if (i > lastToolIndex && responseText) {
          const respCleaned = stripThinkSections(responseText)
          if (respCleaned) {
            if (isErrorText(respCleaned)) {
              blocks.push({
                kind: "error",
                key: `${message.id}:error:flush-${i}`,
                text: formatErrorDisplayText(respCleaned),
              })
            } else {
              blocks.push({
                kind: "final-response",
                key: `${message.id}:response:${i}`,
                text: respCleaned,
              })
            }
          }
          responseText = ""
        }
        mergeSummarizationCheckpointBlock(blocks, message.id, i, part.text)
        continue
      }

      const cleaned = stripThinkTags(part.text)

      // 如果当前索引在最后一个工具调用之后，则视为最终响应（累积避免 markdown 跨 part 断裂）
      if (i > lastToolIndex) {
        flushSkillExplore("end")
        responseText += part.text
      } else if (cleaned) {
        // 如果处于技能探索模式，累积思考文本；否则作为独立的思考块添加
        if (skillExploreOpen) {
          skillThinkingText += (skillThinkingText ? "\n" : "") + cleaned
        } else {
          blocks.push({
            kind: "thinking",
            key: `${message.id}:thinking:${i}`,
            text: cleaned,
          })
        }
      }

      continue
    }

    // 处理工具 UI 部分：识别技能调用并管理技能探索状态
    if (isToolUIPart(part)) {
      const toolInput = "input" in part ? (part as ToolUIPart).input : undefined
      const toolName = part.type.startsWith("tool-")
        ? part.type.slice(5)
        : part.type
      const isSkill = isSkillToolCall(toolInput, toolName)

      // 检测到技能开始且未开启探索模式时，初始化技能探索状态并合并之前的思考内容
      if (isSkill && !skillExploreOpen) {
        skillExploreOpen = true
        const prevThinking =
          blocks.length > 0 && blocks[blocks.length - 1].kind === "thinking"
            ? (blocks.pop() as Extract<ClassifiedBlock, { kind: "thinking" }>)
            : null
        if (prevThinking) {
          skillThinkingText = prevThinking.text
        }
      }

      // 如果当前不是技能但处于技能探索模式中，则结束当前的技能探索
      if (!isSkill && skillExploreOpen) {
        flushSkillExplore("tool")
      }

      pushSingleTool(part, i)
      continue
    }
  }

  flushSkillExplore("end")

  if (responseText) {
    const cleaned = stripThinkSections(responseText)
    if (isErrorText(cleaned)) {
      blocks.push({
        kind: "error",
        key: `${message.id}:error:final`,
        text: formatErrorDisplayText(cleaned),
      })
    } else {
      blocks.push({
        kind: "final-response",
        key: `${message.id}:response:final`,
        text: cleaned,
      })
    }
  }

  const shouldIncludeFileChanges = options.includeFileChanges === true
  const fileChanges = shouldIncludeFileChanges
    ? getFileChangesFromUIMessage(message)
    : []
  // 草稿技能改由 DraftSkillSaveCard 卡片承载，文件变更面板里去重移除，避免重复。
  const panelFileChanges = fileChanges.filter((c) => c.kind !== "skill-folder")
  if (panelFileChanges.length > 0) {
    blocks.push({
      kind: "file-changes",
      key: `${message.id}:file-changes`,
      files: panelFileChanges,
    })
  }
  for (const item of fileChanges) {
    if (item.kind === "skill-folder") {
      blocks.push({
        kind: "draft-skill-save",
        key: `draft-skill-save:${item.path}`,
        skillName: item.title,
        skillPath: item.path,
      })
    }
  }

  return collapseDocumentPlanBlocks(
    collapseWriteTodosBlocks(mergeRoutineToolGroups(blocks))
  )
}

/**
 * UIMessage.parts 分类收集逻辑
 *
 * 输入: UIMessage.parts[] (按流式到达顺序排列的 text / tool-* parts)
 *
 * ━━━ 场景 A — 纯文本对话 (无工具调用) ━━━━━━━━━━━━━━━━━━━━━━
 *
 *   parts: [text, text, ...]
 *             │
 *             ▼ 合并所有 text, 去除 <think/> 块
 *   output: [final-response]
 *
 *
 * ━━━ 场景 B — 普通工具调用 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 *   parts: [text₀, tool₁, tool₂, text₃]
 *             │      │      │      │
 *             │      │      │      └── i > lastTool
 *             │      │      │          → final-response
 *             │      │      └──────────→ tool-group (execute)
 *             │      └─────────────────→ tool-group (read_file)
 *             └────────────────────────→ thinking
 *
 *   lastToolIndex = 2 (最后一个 tool part 的位置)
 *
 *   规则:
 *     text part  + i ≤ lastToolIndex  → thinking    (去除 <think/> 标签)
 *     text part  + i > lastToolIndex  → final-response (去除 <think/> 块)
 *     tool-* part                      → tool-group  (1 tool/block)
 *
 *
 * ━━━ 场景 C — 技能探索 (含 /skills/ 路径的工具调用) ━━━━━━━━━
 *
 *   用户发送: "今天有什么热点新闻"
 *             │
 *             ▼
 *   parts 按流式顺序（示例）:
 *
 *     text₀
 *       └→ 吞入 skill-exploration.thinkingText（与后续连续技能工具同块输出）
 *
 *     tool₁ read …/skills/…     isSkillToolCall=true，开启 skillExploreOpen
 *     tool₂ ls …/skills/…       isSkill=true
 *     tool₃ read …/SKILL.md     isSkill=true
 *       └→ 合并为一个 skill-exploration 折叠块，items ≈ [read, ls, read]
 *
 *     tool₄ execute script      isSkill=false
 *       └→ flushSkillExplore("tool") → 单独 tool-group（独立展示，与普通工具一致）
 *
 *     text₅（i > lastToolIndex）
 *       └→ flushSkillExplore("end") → final-response
 *
 *   output: [ skill-exploration, tool-group(execute), final-response ]
 *             ╰─── 默认折叠 ───╯   ╰── 正常展示 ──╯   ╰── 正常展示 ─╯
 *
 *
 *   技能识别规则 (isSkillToolCall):
 *     read_file  → input.file_path  以 /skills/ 或 /skills-draft/ 开头
 *     ls         → input.path       以 /skills/ 或 /skills-draft/ 开头
 *     glob       → input.path       以 /skills/ 或 /skills-draft/ 开头
 *     grep       → input.path       以 /skills/ 或 /skills-draft/ 开头
 *     execute    → 不匹配 (始终走 tool-group，不受影响)
 *     write_file → 不匹配 (始终走 tool-group)
 *
 *
 * ━━━ 输出: ClassifiedBlock[] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 *   | "thinking"          — 工具调用之前的 AI 推理文本
 *   | "tool-group"        — 普通工具调用 (含 input/output/state)
 *   | "skill-exploration" — 连续技能探索调用合并为折叠块 (默认收起)
 *   | "plan-generated"    — 编排计划卡片 (create_orchestration_plan)
 *   | "recruitment-candidates" — 招聘候选人卡片 (recruit_employee)
 *   | "employee-hired"    — 入职工牌卡片 (hire_employee)
 *   | "employees-hired"   — 批量入职工牌卡片 (hire_employees)
 *   | "employee-detail"   — 员工详情卡片 (get_employee)
 *   | "employee-updated"  — 员工更新卡片 (update_employee)
 *   | "employee-deleted"  — 员工解聘卡片 (delete_employee)
 *   | "tasks-deleted"     — 批量删除任务卡片 (delete_tasks_batch)
 *   | "employees-dismissed" — 批量解聘卡片 (delete_employees_batch)
 *   | "destructive-delete" — 危险删除确认卡 (delete_employee/delete_employees_batch/delete_task/delete_tasks_batch pending)
 *   | "final-response"    — 所有工具调用完成后的最终回复
 *   | "file-changes"      — write_file/edit_file 产生的文件变更卡片
 */
