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
  IconSettings,
  IconSparkles,
  IconSparklesFilled,
} from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"
import { useAuthStore } from "@/stores/auth-store"
import { useChatStore, type ActiveTab } from "@/stores/chat-store"
import { useConversationStatusStore } from "@/stores/conversation-status-store"
import { NotificationBell } from "../notifications/notification-center"

// 导入所有头像资源
import Avatar1 from "@/assets/avaters/1.png"
import Avatar2 from "@/assets/avaters/2.png"
import Avatar3 from "@/assets/avaters/3.png"
import Avatar4 from "@/assets/avaters/4.png"
import Avatar5 from "@/assets/avaters/5.png"
import Avatar6 from "@/assets/avaters/6.png"
import Avatar7 from "@/assets/avaters/7.png"
import Avatar8 from "@/assets/avaters/8.png"
import Avatar9 from "@/assets/avaters/9.png"
import { useEffect } from "react"

// 头像映射
const avatars = [
  Avatar1,
  Avatar2,
  Avatar3,
  Avatar4,
  Avatar5,
  Avatar6,
  Avatar7,
  Avatar8,
  Avatar9,
  Avatar1, // 第10个使用第1个头像
]

const tabs: {
  id: ActiveTab
  icon: React.ComponentType<{ className?: string }>
  iconFilled: React.ComponentType<{ className?: string }>
  label: string
}[] = [
    {
      id: "workbench",
      icon: IconLayoutDashboard,
      iconFilled: IconLayoutDashboardFilled,
      label: "工作台",
    },
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
    {
      id: "skills",
      icon: IconSparkles,
      iconFilled: IconSparklesFilled,
      label: "技能管理",
    },
  ]

export function AppToolbar({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const activeTab = useChatStore((s) => s.activeTab)
  const setActiveTab = useChatStore((s) => s.setActiveTab)
  const logout = useAuthStore((s) => s.logout)
  const user = useAuthStore((s) => s.user)
  const restoreSession = useAuthStore((s) => s.restoreSession)
  useEffect(() => {
    ; (async () => {
      await restoreSession()
    })()
  }, [restoreSession])
  const [showLogoutDialog, setShowLogoutDialog] = React.useState(false)

  const totalUnread = useConversationStatusStore((s) =>
    Object.values(s.unreadCounts).reduce((sum, n) => sum + n, 0),
  )

  // 根据用户ID计算头像索引（1-10）
  const getAvatarIndex = () => {
    if (!user?.id) return 0
    return parseInt(user.id.toString()) % 10
  }

  const handleLogout = () => {
    setShowLogoutDialog(false)
    logout()
  }

  return (
    <>
      <AlertDialog open={showLogoutDialog} onOpenChange={setShowLogoutDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>退出登录</AlertDialogTitle>
            <AlertDialogDescription>
              确定要退出当前账号吗？退出后需要重新登录。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleLogout}>
              确定退出
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div
        className={cn(
          "flex h-full w-16 flex-col items-center border-r bg-muted/50 py-3",
          className
        )}
        {...props}
      >
        <div className="mb-4 overflow-hidden rounded">
          <img
            src={avatars[getAvatarIndex()]}
            alt={user?.name || "用户"}
            className="size-10 object-cover"
          />
        </div>

        <nav className="flex flex-1 flex-col items-center gap-2">
          {tabs.map((tab) => (
            <Tooltip key={tab.id}>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "relative size-10 rounded-lg",
                    activeTab === tab.id && "bg-accent text-accent-foreground"
                  )}
                  data-tour-id={
                    tab.id === "contacts" ? "contacts-tab" : undefined
                  }
                  onClick={() => setActiveTab(tab.id)}
                >
                  {activeTab === tab.id ? (
                    <tab.iconFilled className="size-6 text-primary" />
                  ) : (
                    <tab.icon className="size-6" />
                  )}
                  {tab.id === "chat" && totalUnread > 0 && (
                    <span className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-destructive text-[10px] text-white">
                      {totalUnread > 99 ? "99" : totalUnread}
                    </span>
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={8}>
                {tab.label}
              </TooltipContent>
            </Tooltip>
          ))}
        </nav>

        <div className="mt-auto flex flex-col gap-2">
          <div data-tour-id="notification-bell">
            <NotificationBell />
          </div>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-10 rounded-lg text-muted-foreground hover:text-foreground"
                data-tour-id="settings-btn"
                onClick={() => window.electronApi?.openSettings()}
              >
                <IconSettings className="size-5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={8}>
              设置
            </TooltipContent>
          </Tooltip>

          {/* <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-10 rounded-lg text-muted-foreground hover:text-destructive"
                onClick={() => setShowLogoutDialog(true)}
              >
                <IconLogout className="size-5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={8}>
              退出登录
            </TooltipContent>
          </Tooltip> */}
        </div>
      </div>
    </>
  )
}
