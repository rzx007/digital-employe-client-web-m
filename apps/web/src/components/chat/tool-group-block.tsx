import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible"
import { cn } from "@workspace/ui/lib/utils"
import {
  CheckCircleIcon,
  ChevronDownIcon,
  LoaderIcon,
  WrenchIcon,
} from "lucide-react"
import type { ComponentProps } from "react"
import { useState } from "react"

import type {
  ClassifiedBlock,
  ToolGroupItem,
} from "@/lib/chat/message-classifier"
import { ToolSummary } from "./tool-summary"

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
  defaultOpen = false,
  className,
  ...props
}: ToolGroupBlockProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen)
  const done = isGroupDone(block.tools)
  const error = hasError(block.tools)

  const StatusIcon = done
    ? error
      ? XCircleIcon
      : CheckCircleIcon
    : LoaderIcon

  return (
    <div className={cn("not-prose", className)} {...props}>
      <Collapsible onOpenChange={setIsOpen} open={isOpen}>
        <CollapsibleTrigger
          className={cn(
            "flex w-full items-center gap-1.5 text-xs transition-colors outline-none",
            error
              ? "text-destructive/70 hover:text-destructive"
              : done
                ? "text-muted-foreground/60 hover:text-muted-foreground"
                : "text-muted-foreground hover:text-foreground"
          )}
        >
          <StatusIcon
            className={cn(
              "size-3 shrink-0",
              !done && "animate-spin",
              done && !error && "text-green-600/70"
            )}
          />
          <WrenchIcon className="size-3 shrink-0" />
          <span className="flex-1 truncate text-left">
            {block.summary}
          </span>
          <ChevronDownIcon
            className={cn(
              "size-3 shrink-0 transition-transform",
              isOpen ? "rotate-180" : "rotate-0"
            )}
          />
        </CollapsibleTrigger>
        <CollapsibleContent
          className={cn(
            "space-y-0.5 pl-5",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0"
          )}
        >
          {block.tools.map((tool) => (
            <ToolSummary
              key={tool.key}
              summary={tool.summary}
              state={tool.state}
              resultText={tool.resultText}
            />
          ))}
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}
