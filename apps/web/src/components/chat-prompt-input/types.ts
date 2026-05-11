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
  placeholder?: string
  size?: "default" | "compact"
  className?: string
  slashCommands?: SlashCommandItem[]
  mentionCandidates?: MentionCandidate[]
  conversationId?: string | number | null
  onAttachmentsChange?: (paths: string[]) => void
}
