"use client"

import { memo } from "react"
import {
  IconCircleCheck,
  IconUserPlus,
  IconUsersPlus,
  IconX,
} from "@tabler/icons-react"
import { cn } from "@workspace/ui/lib/utils"
import type { ToolUiActionKind } from "@/lib/chat/tool-ui-action"

const KIND_ICON: Record<
  ToolUiActionKind,
  typeof IconCircleCheck
> = {
  recruitment_hire_one: IconUserPlus,
  recruitment_hire_batch: IconUsersPlus,
  plan_confirm: IconCircleCheck,
  plan_cancel: IconX,
}

function UserActionSummaryCardInner({
  text,
  uiAction,
  className,
}: {
  text: string
  uiAction?: ToolUiActionKind
  className?: string
}) {
  const Icon =
    (uiAction && KIND_ICON[uiAction]) ?? IconCircleCheck
  const isCancel = uiAction === "plan_cancel"

  return (
    <div
      className={cn(
        "flex w-full max-w-md items-start gap-2 rounded-lg border px-3 py-2 text-sm",
        isCancel
          ? "border-muted-foreground/25 bg-muted/40"
          : "border-primary/20 bg-primary/5",
        className
      )}
    >
      <Icon
        className={cn(
          "mt-0.5 size-4 shrink-0",
          isCancel ? "text-muted-foreground" : "text-primary"
        )}
      />
      <p className="min-w-0 leading-relaxed text-foreground">{text}</p>
    </div>
  )
}

export const UserActionSummaryCard = memo(UserActionSummaryCardInner)
