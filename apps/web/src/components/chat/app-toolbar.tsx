import * as React from "react"
import {
  IconMessage,
  IconUsers,
  IconCalendar,
  IconSettings,
} from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"
import { useChatStore, type ActiveTab } from "@/stores/chat-store"

const tabs: { id: ActiveTab; icon: React.ReactNode; label: string }[] = [
  { id: "chat", icon: <IconMessage className="size-5" />, label: "对话" },
  { id: "contacts", icon: <IconUsers className="size-5" />, label: "联系人" },
  { id: "calendar", icon: <IconCalendar className="size-5" />, label: "日历" },
]

export function AppToolbar({ className, ...props }: React.ComponentProps<"div">) {
  const activeTab = useChatStore((s) => s.activeTab)
  const setActiveTab = useChatStore((s) => s.setActiveTab)

  return (
    <div
      className={cn(
        "flex h-full w-16 flex-col items-center border-r bg-muted/50 py-3",
        className
      )}
      {...props}
    >
      <div className="flex size-10 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-bold mb-4">
        U
      </div>

      <nav className="flex flex-1 flex-col items-center gap-1">
        {tabs.map((tab) => (
          <Tooltip key={tab.id}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "size-10 rounded-lg",
                  activeTab === tab.id && "bg-accent text-accent-foreground"
                )}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.icon}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={8}>
              {tab.label}
            </TooltipContent>
          </Tooltip>
        ))}
      </nav>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-10 rounded-lg text-muted-foreground"
            disabled
          >
            <IconSettings className="size-5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={8}>
          设置
        </TooltipContent>
      </Tooltip>
    </div>
  )
}
