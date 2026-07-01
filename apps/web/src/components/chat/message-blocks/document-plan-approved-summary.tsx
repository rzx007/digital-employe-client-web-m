"use client"

import { memo, useMemo } from "react"
import { cn } from "@workspace/ui/lib/utils"

function splitApprovedPlanSections(text: string): string[] {
  return text
    .trim()
    .split(/\n\n+/)
    .map((block) => block.trim())
    .filter((block) => block && block !== "方案已确认")
}

function DocumentPlanApprovedSummaryInner({
  resultText,
  className,
}: {
  resultText: string
  className?: string
}) {
  const sections = useMemo(
    () => splitApprovedPlanSections(resultText),
    [resultText]
  )

  if (sections.length === 0) return null

  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-border/80 bg-card text-sm",
        className
      )}
    >
      <div className="border-b border-border/60 px-3 py-2">
        <p className="text-xs font-medium text-muted-foreground">
          文档方案已确认
        </p>
      </div>
      <div className="max-h-72 space-y-3 overflow-auto px-3 py-3">
        {sections.map((block, index) => {
          const isOutline =
            block.startsWith("大纲：") && block.includes("\n")
          const body = isOutline ? block.replace(/^大纲：\n?/, "") : block
          const label = isOutline ? "大纲" : null

          if (label) {
            return (
              <div key={index}>
                <p className="mb-1 text-[10px] font-medium text-muted-foreground">
                  {label}
                </p>
                <pre className="rounded-md bg-muted/40 p-2 text-[11px] leading-relaxed whitespace-pre-wrap text-foreground">
                  {body}
                </pre>
              </div>
            )
          }

          return (
            <pre
              key={index}
              className="text-[11px] leading-relaxed whitespace-pre-wrap text-foreground"
            >
              {block}
            </pre>
          )
        })}
      </div>
    </div>
  )
}

export const DocumentPlanApprovedSummary = memo(DocumentPlanApprovedSummaryInner)
