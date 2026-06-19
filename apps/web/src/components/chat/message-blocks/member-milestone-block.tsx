import * as React from "react"
import { cn } from "@workspace/ui/lib/utils"

export type MilestoneKind =
  | "accepted"
  | "progress"
  | "delivered"
  | "failed"
  | "cancelled"

const KIND_META: Record<MilestoneKind, { glyph: string; tone: string }> = {
  accepted: { glyph: "▸", tone: "text-blue-600" },
  progress: { glyph: "•", tone: "text-blue-500" },
  delivered: { glyph: "✓", tone: "text-emerald-600" },
  failed: { glyph: "⚠", tone: "text-red-600" },
  cancelled: { glyph: "⏹", tone: "text-muted-foreground" },
}

function fileName(p: string): string {
  const parts = p.split(/[/\\]/)
  return parts[parts.length - 1] || p
}

/** 成员里程碑：一条轻量「汇报」,区别于完整发言气泡。头像由外层消息行已渲染。 */
export function MemberMilestoneBlock({
  senderName,
  kind,
  text,
  artifacts,
  onOpenArtifact,
  className,
}: {
  senderName: string
  kind: MilestoneKind
  text: string
  artifacts?: string[]
  onOpenArtifact?: (path: string) => void
  className?: string
}) {
  const meta = KIND_META[kind] ?? KIND_META.progress
  return (
    <div
      className={cn(
        "flex w-full min-w-0 flex-col gap-1 rounded-lg border border-border/60 bg-muted/30 px-3 py-2",
        className
      )}
    >
      <div className="flex items-center gap-1.5 text-[13px]">
        <span className={cn("shrink-0 font-semibold", meta.tone)}>
          {meta.glyph}
        </span>
        <span className="shrink-0 font-medium">{senderName}</span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          {text}
        </span>
      </div>
      {artifacts && artifacts.length > 0 ? (
        <div className="flex flex-wrap gap-1 pl-5">
          {artifacts.map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => onOpenArtifact?.(a)}
              className="inline-flex max-w-full items-center truncate rounded-md border border-border/60 bg-background px-1.5 py-0.5 text-[11px] text-foreground/80 transition-colors hover:border-primary/40 hover:text-foreground"
              title={a}
            >
              {fileName(a)}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
