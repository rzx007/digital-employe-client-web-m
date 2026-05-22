import type { UIMessage } from "ai"

/** 流式错误事件注入 text part 时的前缀标记 */
export const ERROR_MARKER = "⚠️ERROR:"

function isErrorText(text: string): boolean {
  return text.startsWith(ERROR_MARKER)
}

function stripErrorMarker(text: string): string {
  return text.slice(ERROR_MARKER.length).trim()
}

import {
  summarizeToolCall,
  isSkillToolCall,
  extractSkillName,
  type ToolCallSummary,
} from "./tool-summarizer"
import {
  getFileChangesFromUIMessage,
  type FileChangeItem,
} from "./file-change-utils"
import { isSummarizationTextPart } from "./langchain-summarization-text"
import { collapseWriteTodosBlocks } from "./collapse-write-todos-blocks"
import { mergeRoutineToolGroups } from "./merge-routine-tool-groups"
import {
  isRecruitmentToolRunning,
  parseEmployeeHiredPayload,
  parseRecruitmentCandidatesPayload,
} from "./recruitment-tool-payload"
import type { TodoItem } from "@/components/chat/message-blocks/tool-shared"

type ToolUIPart = Extract<
  UIMessage["parts"][number],
  { type: `tool-${string}`; toolCallId: string }
>

function isToolUIPart(part: UIMessage["parts"][number]): part is ToolUIPart {
  return part.type.startsWith("tool-") && "toolCallId" in part
}

export interface ToolGroupItem {
  key: string
  toolCallId: string
  toolName: string
  type: string
  state: string
  summary: ToolCallSummary
  resultText: string | null
  input: unknown
  preliminary: boolean
  part: ToolUIPart
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
  | { kind: "tool-group"; key: string; tools: ToolGroupItem[]; summary: string }
  | {
      kind: "todo-plan"
      key: string
      tool: ToolGroupItem
      todos: TodoItem[]
    }
  | { kind: "skill-exploration"; key: string; items: SkillExploreItem[]; thinkingText?: string }
  | { kind: "plan-generated"; key: string; toolCallId: string; input: unknown; state: string }
  | {
      kind: "recruitment-candidates"
      key: string
      toolCallId: string
      state: string
      resultText: string | null
    }
  | {
      kind: "employee-hired"
      key: string
      toolCallId: string
      state: string
      resultText: string | null
    }
  | { kind: "summarization-checkpoint"; key: string; text: string }
  | { kind: "final-response"; key: string; text: string }
  | { kind: "file-changes"; key: string; files: FileChangeItem[] }
  | { kind: "error"; key: string; text: string }

interface ClassifyMessagePartsOptions {
  includeFileChanges?: boolean
}

const THINK_OPEN_RE = /^<think\s*>?\n?/s
const THINK_CLOSE_RE = /\n?\s*<\/think\s*>?\n?/s
const THINK_BLOCK_RE = /<think\s*>?[\s\S]*?<\/think\s*>?\n?/g

function stripThinkTags(text: string): string {
  return text
    .replace(THINK_OPEN_RE, "")
    .replace(THINK_CLOSE_RE, "")
    .trim()
}

function stripThinkSections(text: string): string {
  return text.replace(THINK_BLOCK_RE, "").trim()
}

function extractResultText(part: ToolUIPart): string | null {
  if (!("output" in part) || !part.output) {
    return null
  }

  if (typeof part.output === "string") {
    return part.output || null
  }

  if (typeof part.output !== "object") {
    return null
  }

  const output = part.output as Record<string, unknown>
  if (typeof output.text === "string" && output.text) {
    return output.text
  }

  return null
}

function isPreliminary(part: ToolUIPart): boolean {
  return "preliminary" in part && (part as Record<string, unknown>).preliminary === true
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
  const parts = message.parts
  if (parts.length === 0) return []

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
                  text: stripErrorMarker(c),
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
              text: stripErrorMarker(c),
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
  function pushSingleTool(part: ToolUIPart, index: number) {
    const toolInput = "input" in part ? (part as ToolUIPart).input : undefined
    const summary = summarizeToolCall({
      type: part.type,
      input: toolInput,
    })

    if (summary.toolName === "create_orchestration_plan") {
      blocks.push({
        kind: "plan-generated",
        key: `${message.id}:plan:${index}`,
        toolCallId: part.toolCallId,
        input: toolInput,
        state: ("state" in part ? (part as ToolUIPart).state : "unknown") as string,
      })
      return
    }

    const toolState = (
      "state" in part ? (part as ToolUIPart).state : "unknown"
    ) as string
    const toolResultText = extractResultText(part)

    if (summary.toolName === "recruit_employee") {
      const payload = parseRecruitmentCandidatesPayload(toolResultText)
      if (payload || isRecruitmentToolRunning(toolState)) {
        blocks.push({
          kind: "recruitment-candidates",
          key: `${message.id}:recruit:${index}`,
          toolCallId: part.toolCallId,
          state: toolState,
          resultText: toolResultText,
        })
        return
      }
    }

    if (summary.toolName === "hire_employee") {
      const payload = parseEmployeeHiredPayload(toolResultText)
      if (payload || isRecruitmentToolRunning(toolState)) {
        blocks.push({
          kind: "employee-hired",
          key: `${message.id}:hire:${index}`,
          toolCallId: part.toolCallId,
          state: toolState,
          resultText: toolResultText,
        })
        return
      }
    }

    // 检查当前工具调用是否属于技能类工具，如果是则构建并添加技能探索项
    if (isSkillToolCall(toolInput, summary.toolName)) {
      // 提取技能名称
      const skillName = extractSkillName(toolInput, summary.toolName)
      // 根据技能名称和文件路径生成显示用的基础名称
      const basename = skillName
        ? `${skillName}/${summary.filePath?.split("/").pop() ?? ""}`
        : (summary.filePath?.split("/").pop() ?? summary.toolName)

      // 构造技能探索项并加入列表，随后终止当前处理流程
      skillExploreItems.push({
        key: `${message.id}:skill-explore:${part.toolCallId}:${index}`,
        toolCallId: part.toolCallId,
        toolName: summary.toolName,
        state: ("state" in part ? (part as ToolUIPart).state : "unknown") as string,
        label: `${SKILL_EXPLORE_VERB[summary.toolName] ?? "读取"} ${basename}`,
        skillName,
        input: toolInput,
        resultText: extractResultText(part),
      })
      return
    }

    const tool: ToolGroupItem = {
      key: `${message.id}:tool:${part.toolCallId}:${index}`,
      toolCallId: part.toolCallId,
      toolName: summary.toolName,
      type: part.type,
      state: ("state" in part ? (part as ToolUIPart).state : "unknown") as string,
      summary,
      resultText: extractResultText(part),
      input: toolInput,
      preliminary: isPreliminary(part),
      part,
    }

    blocks.push({
      kind: "tool-group",
      key: `${message.id}:tgroup:${index}`,
      tools: [tool],
      summary: summary.label,
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
                text: stripErrorMarker(respCleaned),
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
      const toolName = part.type.startsWith("tool-") ? part.type.slice(5) : part.type
      const isSkill = isSkillToolCall(toolInput, toolName)

      // 检测到技能开始且未开启探索模式时，初始化技能探索状态并合并之前的思考内容
      if (isSkill && !skillExploreOpen) {
        skillExploreOpen = true
        const prevThinking = blocks.length > 0 && blocks[blocks.length - 1].kind === "thinking"
          ? blocks.pop() as Extract<ClassifiedBlock, { kind: "thinking" }>
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
        text: stripErrorMarker(cleaned),
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
  if (fileChanges.length > 0) {
    blocks.push({
      kind: "file-changes",
      key: `${message.id}:file-changes`,
      files: fileChanges,
    })
  }

  return collapseWriteTodosBlocks(mergeRoutineToolGroups(blocks))
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
 *   | "final-response"    — 所有工具调用完成后的最终回复
 *   | "file-changes"      — write_file/edit_file 产生的文件变更卡片
 */