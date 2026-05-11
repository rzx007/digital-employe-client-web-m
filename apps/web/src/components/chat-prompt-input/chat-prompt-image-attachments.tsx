import { useState } from "react"
import type { PromptAttachmentFile } from "@workspace/ui/components/ai-elements/prompt-input"
import { Spinner } from "@/components/spinner"
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
    <div className="flex flex-wrap gap-2">
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

  const showPending = !conversationId
  const showUploading =
    Boolean(conversationId) && state?.status === "uploading"
  const showDone = state?.status === "done"
  const showError = state?.status === "error"

  return (
    <div className="group relative h-12 max-w-[min(40vw,12rem)] shrink-0">
      <AttachmentRemoveButton onClick={onRemove} />
      <div className="relative h-full max-w-full overflow-hidden rounded-md border border-border/50 bg-muted/40">
        {!imgFailed ? (
          <img
            alt=""
            src={file.url}
            draggable={false}
            className="h-12 w-auto max-w-[min(40vw,12rem)] object-cover"
            onError={() => setImgFailed(true)}
          />
        ) : (
          <div
            className="flex h-12 min-w-[4rem] items-center justify-center bg-muted px-2 text-[10px] text-muted-foreground"
            title={file.filename || undefined}
          >
            预览失败
          </div>
        )}

        {showPending && (
          <span className="pointer-events-none absolute right-1 bottom-1 rounded-full bg-yellow-100 px-1.5 py-0.5 text-[9px] text-yellow-800 shadow-sm">
            待上传
          </span>
        )}

        {showUploading && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/60">
            <Spinner className="size-5 text-muted-foreground" />
          </div>
        )}

        {showDone && !showUploading && (
          <span
            className="pointer-events-none absolute right-1 bottom-1 flex size-3 items-center justify-center rounded-full bg-green-600 text-xs text-white shadow-sm"
            aria-hidden
          >
            ✓
          </span>
        )}

        {showError && !showUploading && (
          <span
            className="pointer-events-none absolute right-1 bottom-1 flex size-5 cursor-help items-center justify-center rounded-full bg-red-600 text-[11px] font-semibold text-white shadow-sm"
            title={state?.error}
            aria-label={state?.error}
          >
            ✗
          </span>
        )}
      </div>
    </div>
  )
}
