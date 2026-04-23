import { cn } from "@workspace/ui/lib/utils"
import type { ComponentProps } from "react"

import type {
  ClassifiedBlock,
  ToolGroupItem,
} from "@/lib/chat/message-classifier"
import { ToolActionRow } from "./tool-action-row"

export type ToolGroupBlockProps = ComponentProps<"div"> & {
  block: Extract<ClassifiedBlock, { kind: "tool-group" }>
  defaultOpen?: boolean
}

function isGroupDone(tools: ToolGroupItem[]): boolean {
  return tools.every(
    (t) =>
      t.state === "output-available" || t.state === "output-error"
  )
}

function hasError(tools: ToolGroupItem[]): boolean {
  return tools.some((t) => t.state === "output-error")
}

export function ToolGroupBlock({
  block,
  className,
  ...props
}: ToolGroupBlockProps) {
  if (block.tools.length === 1) {
    const tool = block.tools[0]
    return (
      <ToolActionRow
        className={cn("not-prose", className)}
        summary={tool.summary}
        state={tool.state}
        resultText={tool.resultText}
        input={tool.input}
        {...props}
      />
    )
  }

  const done = isGroupDone(block.tools)
  const error = hasError(block.tools)

  return (
    <div className={cn("not-prose rounded-lg border border-border/50 bg-muted/30 px-3 py-2", className)} {...props}>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {done ? (error ? "x" : "done") : "..."}
        <span className="truncate">{block.summary}</span>
      </div>
      <div className="mt-1.5 space-y-1.5">
        {block.tools.map((tool) => (
          <ToolActionRow
            key={tool.key}
            summary={tool.summary}
            state={tool.state}
            resultText={tool.resultText}
            input={tool.input}
          />
        ))}
      </div>
    </div>
  )
}
