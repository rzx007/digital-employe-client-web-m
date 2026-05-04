import { cn } from "@workspace/ui/lib/utils"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible"
import {
  IconChevronDown,
  IconCircleCheck,
  IconFileDescription,
  IconFolder,
  IconLoader,
  IconSearch,
  IconXboxX,
} from "@tabler/icons-react"
import type { ComponentProps } from "react"
import { useState, memo } from "react"
import type { SkillExploreItem } from "@/lib/chat/message-classifier"

export type SkillExplorationBlockProps = ComponentProps<"div"> & {
  items: SkillExploreItem[]
  thinkingText?: string
}

const TOOL_ITEM_ICON_MAP: Record<string, typeof IconFileDescription> = {
  read_file: IconFileDescription,
  ls: IconFolder,
  glob: IconSearch,
  grep: IconSearch,
}

function isDone(state: string): boolean {
  return state === "output-available" || state === "output-error"
}

function SkillExplorationBlockInner({
  items,
  thinkingText,
  className,
  ...props
}: SkillExplorationBlockProps) {
  const [isOpen, setIsOpen] = useState(false)

  if (items.length === 0) return null

  const allDone = items.every((item) => isDone(item.state))
  const uniqueSkills = [...new Set(items.map((item) => item.skillName).filter(Boolean))]
  const inProgress = !allDone

  const summaryText = inProgress
    ? "正在探索技能..."
    : `探索了 ${items.length} 个技能文件`

  const matchedLabel = uniqueSkills.length > 0
    ? `匹配到技能：${uniqueSkills.join("、")}`
    : null

  return (
    <div className={cn("not-prose", className)} {...props}>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger
          className={cn(
            "flex w-full items-center gap-1.5 rounded-md text-xs transition-colors",
            "outline-none focus-visible:ring-0 hover:bg-muted/50",
            "text-muted-foreground/70 hover:text-muted-foreground",
            "px-2 py-1.5",
            isOpen && "mb-1"
          )}
        >
          {inProgress ? (
            <IconLoader className="size-3 shrink-0 animate-spin" />
          ) : (
            <IconSearch className="size-3 shrink-0" />
          )}
          <span className="flex-1 text-left">{summaryText}</span>
          {matchedLabel && !inProgress && (
            <span className="text-muted-foreground/50 text-[11px] truncate max-w-[200px]">
              {matchedLabel}
            </span>
          )}
          <IconChevronDown
            className={cn(
              "size-3 shrink-0 transition-transform",
              isOpen ? "rotate-180" : "rotate-0"
            )}
          />
        </CollapsibleTrigger>
        <CollapsibleContent
          className={cn(
            "overflow-hidden",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0"
          )}
        >
          <div className="ml-1 border-l border-border/40 pl-3 py-0.5 space-y-0.5">
            {thinkingText && (
              <div className="text-[11px] leading-relaxed text-muted-foreground/50 italic mb-1">
                {thinkingText.length > 120
                  ? thinkingText.slice(0, 120) + "..."
                  : thinkingText}
              </div>
            )}
            {items.map((item) => {
              const ItemIcon = TOOL_ITEM_ICON_MAP[item.toolName] ?? IconFileDescription
              const itemDone = isDone(item.state)
              const itemError = item.state === "output-error"

              return (
                <div
                  key={item.key}
                  className="flex items-center gap-1.5 text-[11px] text-muted-foreground/60"
                >
                  {itemDone ? (
                    itemError ? (
                      <IconXboxX className="size-3 shrink-0 text-destructive/50" />
                    ) : (
                      <IconCircleCheck className="size-3 shrink-0 text-green-600/60" />
                    )
                  ) : (
                    <IconLoader className="size-3 shrink-0 animate-spin" />
                  )}
                  <ItemIcon className="size-3 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </div>
              )
            })}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}

export const SkillExplorationBlock = memo(SkillExplorationBlockInner)
