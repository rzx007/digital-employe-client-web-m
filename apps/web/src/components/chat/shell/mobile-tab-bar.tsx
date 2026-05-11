import * as React from "react"
import {
  IconMessage,
  IconMessage2Filled,
  IconUser,
  IconUserFilled,
  IconCalendar,
  IconCalendarFilled,
  IconLayoutDashboard,
  IconLayoutDashboardFilled,
} from "@tabler/icons-react"
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
    id: "workbench",
    icon: IconLayoutDashboard,
    iconFilled: IconLayoutDashboardFilled,
    label: "工作台",
  },
  {
    id: "calendar",
    icon: IconCalendar,
    iconFilled: IconCalendarFilled,
    label: "日历",
  },
]

export function MobileTabBar({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const activeTab = useChatStore((s) => s.activeTab)
  const setActiveTab = useChatStore((s) => s.setActiveTab)

  return (
    <div
      className={cn(
        "pb-safe flex shrink-0 items-center border-t bg-background",
        className
      )}
      {...props}
    >
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id
        return (
          <button
            key={tab.id}
            className={cn(
              "flex flex-1 flex-col items-center gap-0.5 py-2 transition-colors",
              isActive ? "text-primary" : "text-muted-foreground"
            )}
            onClick={() => setActiveTab(tab.id)}
          >
            {isActive ? (
              <tab.iconFilled className="size-5" />
            ) : (
              <tab.icon className="size-5" />
            )}
            <span className="text-[10px]">{tab.label}</span>
          </button>
        )
      })}
    </div>
  )
}
