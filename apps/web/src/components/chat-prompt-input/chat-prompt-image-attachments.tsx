import { useState } from "react"
import type { PromptAttachmentFile } from "@workspace/ui/components/ai-elements/prompt-input"
import {
  AttachmentStatusDot,
  resolveAttachmentStatus,
} from "./attachment-status-dot"
import { AttachmentRemoveButton } from "./attachment-remove-button"
import type { UploadFileState } from "./types"

export function ChatPromptImageAttachments({
  files,
  fileStates,
  conversationId,
  onRemove,
}: {
  files: PromptAttachmentFile[]
  fileStates: Record<string, UploadFileState>
  conversationId: string | number | null
  onRemove: (id: string) => void
}) {
  if (files.length === 0) return null

  return (
    <div className="flex min-w-0 flex-wrap gap-1.5 @[18rem]/prompt-input:gap-2">
      {files.map((file) => (
        <ChatPromptImageThumb
          key={file.id}
          file={file}
          state={fileStates[file.id]}
          conversationId={conversationId}
          onRemove={() => onRemove(file.id)}
        />
      ))}
    </div>
  )
}

function ChatPromptImageThumb({
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
  const [imgFailed, setImgFailed] = useState(false)
  const statusVariant = resolveAttachmentStatus(conversationId, state)

  return (
    <div className="group relative h-10 max-w-[min(42cqw,9rem)] shrink-0 @[18rem]/prompt-input:h-12 @[18rem]/prompt-input:max-w-[min(42cqw,12rem)]">
      <AttachmentRemoveButton onClick={onRemove} />
      <div className="relative h-full max-w-full overflow-hidden rounded-md border border-border/50 bg-muted/40">
        {!imgFailed ? (
          <img
            alt=""
            src={file.url}
            draggable={false}
            className="h-10 w-auto max-w-[min(42cqw,9rem)] object-cover @[18rem]/prompt-input:h-12 @[18rem]/prompt-input:max-w-[min(42cqw,12rem)]"
            onError={() => setImgFailed(true)}
          />
        ) : (
          <div
            className="flex h-10 min-w-[3.5rem] items-center justify-center bg-muted px-2 text-[9px] text-muted-foreground @[18rem]/prompt-input:h-12 @[18rem]/prompt-input:min-w-[4rem] @[18rem]/prompt-input:text-[10px]"
            title={file.filename || undefined}
          >
            预览失败
          </div>
        )}

        {statusVariant ? (
          <AttachmentStatusDot
            variant={statusVariant}
            detail={statusVariant === "error" ? state?.error : undefined}
          />
        ) : null}
      </div>
    </div>
  )
}
