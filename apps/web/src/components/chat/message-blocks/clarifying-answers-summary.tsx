"use client"

import { memo } from "react"
import { cn } from "@workspace/ui/lib/utils"
import type { ClarifyAnswerItem } from "@/lib/chat/clarifying-questions-utils"

function ClarifyingAnswersSummaryInner({
  items,
  className,
}: {
  items: ClarifyAnswerItem[]
  className?: string
}) {
  if (items.length === 0) return null

  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-border/80 bg-card text-sm",
        className
      )}
    >
      <div className="border-b border-border/60 px-3 py-2">
        <p className="text-xs font-medium text-muted-foreground">Answers</p>
      </div>
      <ul className="space-y-3 px-3 py-3">
        {items.map((item, i) => (
          <li key={`${i}-${item.question.slice(0, 24)}`}>
            <p className="text-[11px] leading-snug text-muted-foreground">
              {item.question}
            </p>
            <p className="mt-0.5 text-sm leading-snug text-foreground">
              {item.answer}
            </p>
          </li>
        ))}
      </ul>
    </div>
  )
}

export const ClarifyingAnswersSummary = memo(ClarifyingAnswersSummaryInner)
