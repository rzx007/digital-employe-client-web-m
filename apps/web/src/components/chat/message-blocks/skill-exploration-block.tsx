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
  const uniqueSkills = [
    ...new Set(items.map((item) => item.skillName).filter(Boolean)),
  ]
  const inProgress = !allDone

  const summaryText = inProgress
    ? "正在探索技能..."
    : `探索了 ${items.length} 个技能文件`

  const matchedLabel =
    uniqueSkills.length > 0 ? `匹配到技能：${uniqueSkills.join("、")}` : null

  return (
    <div className={cn("not-prose", className)} {...props}>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger
          className={cn(
            "group/skill-explore flex w-full items-center gap-1 rounded-md text-xs transition-colors",
            "outline-none hover:bg-muted/50 focus-visible:ring-0",
            "text-muted-foreground/70 hover:text-muted-foreground",
            "px-1.5 py-1",
            isOpen && "mb-0.5"
          )}
        >
          {inProgress ? (
            <IconLoader className="size-3 shrink-0 animate-spin" />
          ) : (
            <IconSearch className="size-3 shrink-0" />
          )}
          <span className="flex-1 text-left">{summaryText}</span>
          {matchedLabel && !inProgress && (
            <span className="max-w-[200px] truncate text-[11px] text-muted-foreground/50">
              {matchedLabel}
            </span>
          )}
          <IconChevronDown
            className={cn(
              "hidden size-3 shrink-0 text-muted-foreground/50 transition-transform",
              "group-hover/skill-explore:block group-focus-visible/skill-explore:block",
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
          <div className="ml-0.5 space-y-0 border-l border-border/40 py-0 pl-2">
            {thinkingText && (
              <div className="mb-0.5 text-[11px] leading-relaxed text-muted-foreground/50 italic">
                {thinkingText.length > 120
                  ? thinkingText.slice(0, 120) + "..."
                  : thinkingText}
              </div>
            )}
            {items.map((item) => {
              const ItemIcon =
                TOOL_ITEM_ICON_MAP[item.toolName] ?? IconFileDescription
              const itemDone = isDone(item.state)
              const itemError = item.state === "output-error"

              return (
                <div
                  key={item.key}
                  className="flex items-center gap-1 py-0.5 text-[11px] text-muted-foreground/60"
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
