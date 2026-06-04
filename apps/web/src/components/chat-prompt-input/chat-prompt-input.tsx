import {
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuTrigger,
  PromptInputBody,
  PromptInputFooter,
  PromptInputHeader,
  PromptInputSubmit,
  PromptInputTools,
} from "@workspace/ui/components/ai-elements/prompt-input"
import { LexicalPromptInputTextarea } from "../lexical-editor/prompt-input-textarea"
import { Separator } from "@workspace/ui/components/separator"
import { ChatPromptInputAttachments } from "./chat-prompt-input-attachments"
import { ACCEPTED_FILE_TYPES, MAX_UPLOAD_SIZE_BYTES } from "./constants"
import type { ChatPromptInputProps } from "./types"
import { cn } from "@workspace/ui/lib/utils"
import { ContextBudgetIndicator } from "@/components/chat/panel/context-budget-indicator"

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
  conversationId,
  onAttachmentsChange,
  messages,
}: ChatPromptInputProps) {
  const isCompact = size === "compact"

  return (
    <PromptInput
      globalDrop
      multiple
      accept={ACCEPTED_FILE_TYPES}
      maxFileSize={MAX_UPLOAD_SIZE_BYTES}
      maxFiles={10}
      onSubmit={onSubmit}
      className={cn("@container/prompt-input min-w-0", className)}
    >
      <PromptInputHeader>
        {onAttachmentsChange && (
          <ChatPromptInputAttachments
            conversationId={conversationId ?? null}
            onAttachmentsChange={onAttachmentsChange}
            status={status}
          />
        )}
      </PromptInputHeader>
      <PromptInputBody
        className={cn(
          isCompact ? "min-h-[60px]" : "min-h-[100px]",
          "max-h-[200px] overflow-auto"
        )}
      >
        <LexicalPromptInputTextarea
          onChange={onChange}
          value={value}
          placeholder={placeholder}
          commands={slashCommands}
          mentionCandidates={mentionCandidates}
          disabled={false}
          className={`resize-none placeholder:text-muted-foreground/60 ${isCompact ? "min-h-[60px] text-base" : "min-h-28 text-lg"}`}
        />
      </PromptInputBody>
      <PromptInputFooter>
        <PromptInputTools>
          <PromptInputActionMenu>
            <PromptInputActionMenuTrigger />
            <PromptInputActionMenuContent className="w-48">
              <PromptInputActionAddAttachments
                className="w-full"
                label="上传文件或图片"
              />
            </PromptInputActionMenuContent>
          </PromptInputActionMenu>
          <Separator orientation="vertical" className="mt-2 mr-3 h-3" />
          <ContextBudgetIndicator
            conversationId={conversationId}
            messages={messages ?? []}
            chatStatus={status}
          />
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
  )
}
