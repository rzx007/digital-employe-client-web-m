import type { PromptAttachmentFile } from "@workspace/ui/components/ai-elements/prompt-input"
import { getFileIcon } from "@/lib/chat/file-icons"
import {
  AttachmentStatusDot,
  resolveAttachmentStatus,
} from "./attachment-status-dot"
import { AttachmentRemoveButton } from "./attachment-remove-button"
import { formatAttachmentDisplaySize } from "./format-attachment-size"
import type { UploadFileState } from "./types"

export function ChatPromptFileAttachmentCard({
  file,
  state,
  conversationId,
  onRemove,
}: {
  file: PromptAttachmentFile
  state: UploadFileState | undefined
  conversationId: string | number | null
  onRemove: () => void
}) {
  const filename = file.filename || "unknown"
  const sizeBytes = state?.sizeBytes ?? file.sizeBytes
  const statusVariant = resolveAttachmentStatus(conversationId, state)

  return (
    <div className="group relative flex w-full min-w-0 items-center gap-1.5 rounded-md border border-border/50 bg-background/70 px-1.5 py-1 @[18rem]/prompt-input:gap-2 @[18rem]/prompt-input:px-2 @[18rem]/prompt-input:py-1.5">
      <AttachmentRemoveButton onClick={onRemove} />
      <img
        alt=""
        aria-hidden="true"
        className="size-6 shrink-0 @[18rem]/prompt-input:size-7"
        draggable={false}
        src={getFileIcon(filename)}
      />
      <div className="min-w-0 flex-1 overflow-hidden">
        <div className="flex w-full min-w-0 flex-col gap-0.5">
          <span
            className="min-w-0 truncate text-[10px] text-foreground @[18rem]/prompt-input:text-[11px]"
            title={filename}
          >
            {filename}
          </span>
          <span className="text-[9px] text-muted-foreground tabular-nums @[18rem]/prompt-input:text-[10px]">
            {formatAttachmentDisplaySize(sizeBytes)}
          </span>
        </div>
      </div>
      {statusVariant ? (
        <AttachmentStatusDot
          variant={statusVariant}
          detail={statusVariant === "error" ? state?.error : undefined}
        />
      ) : null}
    </div>
  )
}
