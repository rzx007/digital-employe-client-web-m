import { IconChevronDown, IconCheck } from "@tabler/icons-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { cn } from "@workspace/ui/lib/utils"

export type WorkbenchChatTarget = "curator" | "assistant"

const LABEL: Record<WorkbenchChatTarget, string> = {
  curator: "总管助手",
  assistant: "工作台助手",
}

/**
 * 工作台对话头部的「总管 ⇄ 工作台助手」下拉切换。
 * 放在对话标题处（替代纯文字标题），点开选对话对象。
 */
export function WorkbenchChatTargetSwitch({
  value,
  onChange,
  assistantAvailable = true,
}: {
  value: WorkbenchChatTarget
  onChange: (next: WorkbenchChatTarget) => void
  assistantAvailable?: boolean
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-sm font-medium hover:bg-muted"
        >
          {LABEL[value]}
          <IconChevronDown className="size-3.5 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-36">
        {(["curator", "assistant"] as WorkbenchChatTarget[]).map((t) => {
          const disabled = t === "assistant" && !assistantAvailable
          return (
            <DropdownMenuItem
              key={t}
              disabled={disabled}
              onSelect={() => !disabled && onChange(t)}
              className="gap-2"
            >
              <IconCheck
                className={cn(
                  "size-4",
                  value === t ? "opacity-100" : "opacity-0"
                )}
              />
              {LABEL[t]}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
