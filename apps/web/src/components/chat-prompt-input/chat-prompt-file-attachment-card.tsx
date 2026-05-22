import type { ReactNode } from "react"
import type { PromptAttachmentFile } from "@workspace/ui/components/ai-elements/prompt-input"
import { Spinner } from "@/components/spinner"
import { getFileIcon } from "@/lib/chat/file-icons"
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

  let statusLabel: ReactNode = null
  if (!conversationId) {
    statusLabel = (
      <span className="shrink-0 rounded-full bg-yellow-100 px-1.5 py-0.5 text-[9px] text-yellow-700">
        待上传
      </span>
    )
  } else if (state?.status === "uploading") {
    statusLabel = (
      <span className="flex shrink-0 items-center gap-1 text-[9px] text-muted-foreground">
        <Spinner className="size-2.5" />
        上传中
      </span>
    )
  } else if (state?.status === "done") {
    statusLabel = (
      <span className="shrink-0 rounded-full bg-green-100 px-1.5 py-0.5 text-[9px] text-green-700">
        已上传
      </span>
    )
  } else if (state?.status === "error") {
    statusLabel = (
      <span
        className="shrink-0 cursor-help rounded-full bg-red-100 px-1.5 py-0.5 text-[9px] text-red-700"
        title={state.error}
      >
        上传失败
      </span>
    )
  }

  return (
    <div
      className="group relative flex min-w-0 w-full items-center gap-1.5 rounded-md border border-border/50 bg-background/70 px-1.5 py-1 @[18rem]/prompt-input:gap-2 @[18rem]/prompt-input:px-2 @[18rem]/prompt-input:py-1.5"
    >
      <AttachmentRemoveButton onClick={onRemove} />
      <img
        alt=""
        aria-hidden="true"
        className="size-6 shrink-0 @[18rem]/prompt-input:size-7"
        draggable={false}
        src={getFileIcon(filename)}
      />
      <div className="min-w-0 flex-1 overflow-hidden">
        <div className="flex min-w-0 w-full flex-col gap-0.5">
          <span
            className="min-w-0 truncate text-[10px] text-foreground @[18rem]/prompt-input:text-[11px]"
            title={filename}
          >
            {filename}
          </span>
          <span className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 text-[9px] text-muted-foreground tabular-nums @[18rem]/prompt-input:text-[10px]">
            <span className="shrink-0">{formatAttachmentDisplaySize(sizeBytes)}</span>
            {statusLabel}
          </span>
        </div>
      </div>
    </div>
  )
}
