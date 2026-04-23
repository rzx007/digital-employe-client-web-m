import { useCallback } from "react"
import type { FileUIPart } from "ai"
import {
  Attachment,
  AttachmentPreview,
  AttachmentRemove,
  Attachments,
} from "@workspace/ui/components/ai-elements/attachments"
import type { PromptInputMessage } from "@workspace/ui/components/ai-elements/prompt-input"
import {
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuTrigger,
  PromptInputBody,
  PromptInputButton,
  PromptInputFooter,
  PromptInputHeader,
  PromptInputSubmit,
  PromptInputTools,
  usePromptInputAttachments,
} from "@workspace/ui/components/ai-elements/prompt-input"
import {
  LexicalPromptInputTextarea,
  type PromptChangeEvent,
} from "./lexical-editor/prompt-input-textarea"
import { useRuntimeModelConfigQuery } from "@/hooks/use-model-queries"
import type { SlashCommandItem } from "./lexical-editor/slash-command-plugin"
import type { MentionCandidate } from "./lexical-editor/mention-plugin"
import { Separator } from "@workspace/ui/components/separator"

const AttachmentItem = ({
  attachment,
  onRemove,
}: {
  attachment: FileUIPart & { id: string }
  onRemove: (id: string) => void
}) => {
  const handleRemove = useCallback(() => {
    onRemove(attachment.id)
  }, [onRemove, attachment.id])

  return (
    <Attachment data={attachment} onRemove={handleRemove}>
      <AttachmentPreview />
      <AttachmentRemove />
    </Attachment>
  )
}

const PromptInputAttachmentsDisplay = () => {
  const attachments = usePromptInputAttachments()

  const handleRemove = useCallback(
    (id: string) => {
      attachments.remove(id)
    },
    [attachments]
  )

  if (attachments.files.length === 0) {
    return null
  }

  return (
    <Attachments variant="inline">
      {attachments.files.map((attachment) => (
        <AttachmentItem
          attachment={attachment}
          key={attachment.id}
          onRemove={handleRemove}
        />
      ))}
    </Attachments>
  )
}

interface ChatPromptInputProps {
  value: string
  onChange: (e: PromptChangeEvent) => void
  onSubmit: (message: PromptInputMessage) => void
  onStop?: () => void
  status: "submitted" | "streaming" | "ready" | "error"
  disabled?: boolean
  placeholder?: string
  size?: "default" | "compact"
  className?: string
  /** 员工技能生成的斜杠命令 */
  slashCommands?: SlashCommandItem[]
  mentionCandidates?: MentionCandidate[]
}

export function ChatPromptInput({
  value,
  onChange,
  onSubmit,
  onStop,
  status,
  disabled,
  placeholder = "请输入任务，然后交给我",
  size = "default",
  className,
  slashCommands,
  mentionCandidates,
}: ChatPromptInputProps) {
  const runtimeModelQuery = useRuntimeModelConfigQuery()

  const isCompact = size === "compact"
  const isStreaming = status === "streaming" || status === "submitted"
  const currentModel = runtimeModelQuery.isLoading
    ? "加载中..."
    : runtimeModelQuery.isError
      ? "读取失败"
      : runtimeModelQuery.data?.model || "未配置"

  return (
    <div className={className}>
      <PromptInput globalDrop multiple onSubmit={onSubmit} className="">
        <PromptInputHeader>
          <PromptInputAttachmentsDisplay />
        </PromptInputHeader>
        <PromptInputBody
          className={isCompact ? "min-h-[60px]" : "min-h-[100px]"}
        >
          <LexicalPromptInputTextarea
            onChange={onChange}
            value={value}
            placeholder={placeholder}
            commands={slashCommands}
            mentionCandidates={mentionCandidates}
            disabled={isStreaming}
            disabledPlaceholder="AI 正在回复中..."
            className={`resize-none placeholder:text-muted-foreground/60 ${isCompact ? "min-h-[60px] text-base" : "min-h-28 text-lg"
              }`}
          />
        </PromptInputBody>
        <PromptInputFooter>
          <PromptInputTools>
            <PromptInputActionMenu>
              <PromptInputActionMenuTrigger />
              <PromptInputActionMenuContent>
                <PromptInputActionAddAttachments />
              </PromptInputActionMenuContent>
            </PromptInputActionMenu>
            <Separator orientation="vertical" className="h-3 mt-2 mr-3" />
            <PromptInputButton className="w-auto px-0.5" variant="ghost" size="icon-sm">
              {/* <IconMap className="h-4 w-4" /> */}
              {currentModel.toUpperCase()}
            </PromptInputButton>
            {/* <PromptInputButton variant="ghost" size="icon-sm">
              <IconMap className="h-4 w-4" />
            </PromptInputButton> */}

            {/* <PromptInputButton variant="ghost" size="icon-sm">
              <IconSettings className="h-4 w-4" />
            </PromptInputButton> */}
          </PromptInputTools>
          <PromptInputTools>
            <PromptInputSubmit
              disabled={disabled}
              status={status}
              onStop={onStop}
              className="bg-primary/80 transition-colors hover:bg-primary"
            />
          </PromptInputTools>
        </PromptInputFooter>
      </PromptInput>
    </div>
  )
}
