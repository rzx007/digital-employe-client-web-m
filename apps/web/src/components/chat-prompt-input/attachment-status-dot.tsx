import { cn } from "@workspace/ui/lib/utils"

import type { UploadFileState } from "./types"

export type AttachmentStatusVariant =
  | "pending"
  | "uploading"
  | "done"
  | "error"

const STATUS_LABELS: Record<AttachmentStatusVariant, string> = {
  pending: "待上传",
  uploading: "上传中",
  done: "已上传",
  error: "上传失败",
}

const STATUS_DOT_CLASS: Record<AttachmentStatusVariant, string> = {
  pending: "bg-amber-400 ring-amber-400/40",
  uploading: "bg-sky-400 animate-pulse ring-sky-400/40",
  done: "bg-emerald-500 ring-emerald-500/40",
  error: "bg-red-500 ring-red-500/40",
}

export function resolveAttachmentStatus(
  conversationId: string | number | null,
  state: UploadFileState | undefined
): AttachmentStatusVariant | null {
  if (!conversationId) return "pending"
  if (state?.status === "uploading") return "uploading"
  if (state?.status === "done") return "done"
  if (state?.status === "error") return "error"
  return null
}

export function AttachmentStatusDot({
  variant,
  detail,
  className,
}: {
  variant: AttachmentStatusVariant
  detail?: string
  className?: string
}) {
  const label =
    variant === "error" && detail
      ? `上传失败：${detail}`
      : (detail ?? STATUS_LABELS[variant])
  return (
    <span
      className={cn(
        "pointer-events-none absolute right-1 bottom-1 z-10 size-2 rounded-full ring-2 ring-background shadow-sm",
        STATUS_DOT_CLASS[variant],
        variant === "error" && "pointer-events-auto cursor-help",
        className
      )}
      title={label}
      aria-label={label}
      role="status"
    />
  )
}
