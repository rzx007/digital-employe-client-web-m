import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible"
import { cn } from "@workspace/ui/lib/utils"
import { IconBrain, IconChevronDown } from "@tabler/icons-react"
import type { ComponentProps } from "react"
import { useState } from "react"

const SHORT_TEXT_THRESHOLD = 120

export type ThinkingBlockProps = ComponentProps<"div"> & {
  text: string
  defaultOpen?: boolean
}

export function ThinkingBlock({
  text,
  defaultOpen,
  className,
  ...props
}: ThinkingBlockProps) {
  if (!text.trim()) return null

  const isShort = text.length <= SHORT_TEXT_THRESHOLD
  const [isOpen, setIsOpen] = useState(
    defaultOpen ?? isShort
  )

  if (isShort) {
    return (
      <div className={cn("not-prose", className)} {...props}>
        <div className="flex items-start gap-1.5 text-xs text-muted-foreground/60">
          <IconBrain className="mt-0.5 size-3 shrink-0" />
          <p className="leading-relaxed">{text}</p>
        </div>
      </div>
    )
  }

  return (
    <div className={cn("not-prose", className)} {...props}>
      <Collapsible onOpenChange={setIsOpen} open={isOpen}>
        <CollapsibleTrigger
          className={cn(
            "flex w-full items-center gap-1.5 text-xs text-muted-foreground/70 transition-colors hover:text-muted-foreground",
            "outline-none focus-visible:ring-0"
          )}
        >
          <IconBrain className="size-3" />
          <span className="flex-1 text-left">思考过程</span>
          <IconChevronDown
            className={cn(
              "size-3 transition-transform",
              isOpen ? "rotate-180" : "rotate-0"
            )}
          />
        </CollapsibleTrigger>
        <CollapsibleContent
          className={cn(
            "text-xs leading-relaxed text-muted-foreground/60",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0"
          )}
        >
          <p className="mt-1.5 pl-[18px]">{text}</p>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}
