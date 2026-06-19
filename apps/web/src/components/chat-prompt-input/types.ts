import type { ReactNode } from "react"
import type { UIMessage } from "ai"
import type { PromptChangeEvent } from "../lexical-editor/prompt-input-textarea"
import type { PromptInputMessage } from "@workspace/ui/components/ai-elements/prompt-input"
import type { SlashCommandItem } from "../lexical-editor/slash-command-plugin"
import type { MentionCandidate } from "../lexical-editor/mention-plugin"

export type FileUploadStatus = "uploading" | "done" | "error"

export interface UploadFileState {
  id: string
  filename: string
  status: FileUploadStatus
  path?: string
  error?: string
  sizeBytes?: number
}

export type ChatPromptMessageStatus =
  | "submitted"
  | "streaming"
  | "ready"
  | "error"

export interface ChatPromptInputProps {
  value: string
  onChange: (e: PromptChangeEvent) => void
  onSubmit: (message: PromptInputMessage) => void
  onStop?: () => void
  status: ChatPromptMessageStatus
  disabled?: boolean
  placeholder?: ReactNode
  size?: "default" | "compact"
  className?: string
  slashCommands?: SlashCommandItem[]
  mentionCandidates?: MentionCandidate[]
  conversationId?: string | number | null
  onAttachmentsChange?: (paths: string[]) => void
  /** 用于上下文用量指示器的乐观读取（可选） */
  messages?: UIMessage[]
  /** 是否显示上下文用量指示器；群聊等场景传 false */
  showContextBudget?: boolean
  /** 是否显示语音输入（麦克风）按钮；群聊等场景传 false，默认 false */
  showVoiceInput?: boolean
  /**
   * 排队态：当前有流/任务在跑，发送会进待发队列(而非立即发送)。
   * status 仍为 ready(无可停止的流)，但提交按钮改显「排队」图标+提示，避免误以为立即发送。
   */
  queueing?: boolean
}
