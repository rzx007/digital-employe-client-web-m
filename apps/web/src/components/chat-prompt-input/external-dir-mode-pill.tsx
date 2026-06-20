import * as React from "react"
import { IconCheck, IconFolder } from "@tabler/icons-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { cn } from "@workspace/ui/lib/utils"

import { useExternalDirMode } from "@/hooks/use-external-dir-mode"
import type { ExternalDirMode } from "@/api/conversation"

const MODE_LABELS: Record<ExternalDirMode, string> = {
  ask: "询问",
  auto: "自动",
  deny: "严禁",
}

const MODES: ExternalDirMode[] = ["ask", "auto", "deny"]

interface ExternalDirModePillProps {
  conversationId: string | number | null | undefined
  className?: string
}

export function ExternalDirModePill({
  conversationId,
  className,
}: ExternalDirModePillProps) {
  const { mode, setMode } = useExternalDirMode(conversationId)

  // 无会话时不渲染
  if (conversationId == null) return null

  const currentLabel = mode ? MODE_LABELS[mode] : "询问"

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex h-7 items-center gap-1 rounded-full border border-border/60 px-2 text-xs",
            "text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            className
          )}
          title="工作区外目录访问模式"
        >
          <IconFolder className="size-3 shrink-0" />
          <span>目录·{currentLabel}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[120px]">
        {MODES.map((m) => (
          <DropdownMenuItem
            key={m}
            onClick={() => setMode(m)}
            className="gap-2"
          >
            <span className="w-3.5">
              {mode === m ? <IconCheck className="size-3.5" /> : null}
            </span>
            {MODE_LABELS[m]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
