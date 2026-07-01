import type { ToolCallSummary } from "../tool-summarizer"
import type { ToolUIPart } from "./tool-part"

export interface ToolViewModel {
  /** 工具调用的唯一标识 */
  toolCallId: string
  /** 工具的实际名称 (如 "write_file") */
  toolName: string
  /** 工具的原始类型字符串 (如 "tool-write_file") */
  type: string
  /** 工具当前的执行状态 (如 "output-available", "input-streaming", "output-error") */
  state: string
  /** 总结出的工具调用摘要信息 */
  summary: ToolCallSummary
  /** 提取出来的纯文本结果（如果有） */
  resultText: string | null
  /** 工具的输入参数 */
  input: unknown
  /** 是否是临时/初步的输出 */
  preliminary: boolean
  /** 经过处理供展示的预览内容（如果有） */
  displayContent: string | null
  /** 标准化后的文件路径（如果有） */
  normalizedFilePath: string | null
  /** 编辑类工具的差异对象（如果有） */
  editDiff: { oldCode: string; newCode: string } | null
  /** 原始的 part 对象，供需要直接访问它的地方使用 */
  part: ToolUIPart
}
