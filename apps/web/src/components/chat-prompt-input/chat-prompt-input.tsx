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
import { toast } from "sonner"
import { IconClockHour9, IconMicrophone } from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import { LexicalPromptInputTextarea } from "../lexical-editor/prompt-input-textarea"
import { Separator } from "@workspace/ui/components/separator"
import { ChatPromptInputAttachments } from "./chat-prompt-input-attachments"
import { ACCEPTED_FILE_TYPES, MAX_UPLOAD_SIZE_BYTES } from "./constants"
import type { ChatPromptInputProps } from "./types"
import { useVoiceRecorder } from "./use-voice-recorder"
import { VoiceRecorderPill } from "./voice-recorder"
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
  showContextBudget = true,
  showVoiceInput = false,
  queueing = false,
}: ChatPromptInputProps) {
  const isCompact = size === "compact"
  // 排队态(有流/任务在跑、发送会进队列)且按钮非「停止」时，改显「排队」图标+提示。
  const showQueueAffordance =
    queueing && status !== "streaming" && status !== "submitted"

  const recorder = useVoiceRecorder({
    onResult: (result) => {
      onSubmit({
        text: result.text,
        files: [],
        voice: {
          durationMs: result.durationMs,
          waveform: result.waveform,
          blob: result.blob,
        },
      })
    },
    onError: (message) => toast.error(message),
  })

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
          {showContextBudget && (
            <>
              <Separator orientation="vertical" className="mt-2 mr-3 h-3" />
              <ContextBudgetIndicator
                conversationId={conversationId}
                messages={messages ?? []}
                chatStatus={status}
              />
            </>
          )}
        </PromptInputTools>
        <PromptInputTools>
          {recorder.phase !== "idle" ? (
            <VoiceRecorderPill
              phase={recorder.phase}
              elapsedMs={recorder.elapsedMs}
              onStreamReady={recorder.attachStream}
              onSend={() => void recorder.finish()}
              onCancel={recorder.cancel}
              onMicError={(message) => {
                toast.error(message)
                recorder.cancel()
              }}
            />
          ) : (
            <>
              {showVoiceInput && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="rounded-full"
                  disabled={status === "streaming" || status === "submitted"}
                  onClick={recorder.start}
                  aria-label="语音输入"
                >
                  <IconMicrophone className="size-4" />
                </Button>
              )}
              <PromptInputSubmit
                disabled={disabled}
                status={status}
                onStop={onStop}
                className="bg-primary/80 transition-colors hover:bg-primary"
                {...(showQueueAffordance
                  ? {
                      title: "排队发送（当前有任务在执行，完成后自动发送）",
                      "aria-label": "排队发送",
                    }
                  : {})}
              >
                {showQueueAffordance ? (
                  <IconClockHour9 className="size-4" />
                ) : undefined}
              </PromptInputSubmit>
            </>
          )}
        </PromptInputTools>
      </PromptInputFooter>
    </PromptInput>
  )
}
