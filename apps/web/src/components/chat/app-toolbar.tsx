import * as React from "react"
import {
  IconMessage,
  IconMessage2Filled,
  IconUser,
  IconUserFilled,
  IconCalendar,
  IconCalendarFilled,
  IconLogout,
  IconSettings,
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
  const logout = useAuthStore((s) => s.logout)
  const [showLogoutDialog, setShowLogoutDialog] = React.useState(false)

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
            <AlertDialogAction onClick={handleLogout}>确定退出</AlertDialogAction>
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

        <div className="flex flex-col gap-2 mt-auto">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-10 rounded-lg text-muted-foreground hover:text-foreground"
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
