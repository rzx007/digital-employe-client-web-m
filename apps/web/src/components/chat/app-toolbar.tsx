import * as React from "react"
import {
  IconMessage,
  IconMessage2Filled,
  IconUser,
  IconUserFilled,
  IconCalendar,
  IconCalendarFilled,
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

const tabs: {
  id: ActiveTab
  icon: React.ComponentType<{ className?: string }>
  iconFilled: React.ComponentType<{ className?: string }>
  label: string
}[] = [
  {
    id: "chat",
    icon: IconMessage,
    iconFilled: IconMessage2Filled,
    label: "对话",
  },
  {
    id: "contacts",
    icon: IconUser,
    iconFilled: IconUserFilled,
    label: "联系人",
  },
  {
    id: "calendar",
    icon: IconCalendar,
    iconFilled: IconCalendarFilled,
    label: "日历",
  },
]

export function AppToolbar({
  className,
  ...props
}: React.ComponentProps<"div">) {
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
      <div className="mb-4 flex size-10 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
        U
      </div>

      <nav className="flex flex-1 flex-col items-center gap-2">
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
                {activeTab === tab.id ? (
                  <tab.iconFilled className="size-6 text-primary" />
                ) : (
                  <tab.icon className="size-6" />
                )}
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
