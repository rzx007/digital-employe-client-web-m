import * as React from "react"
import {
  IconSun,
  IconMoon,
  IconDeviceDesktop,
  IconRocket,
} from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Switch } from "@workspace/ui/components/switch"
import { useTheme } from "@/components/theme-provider"
import { useOnboardingStore } from "@/stores/onboarding-store"
import { ThemeCard } from "./theme-card"
import { getElectronApi, isElectron } from "@/lib/electron/host"

export function GeneralSettings() {
  const { theme, setTheme } = useTheme()
  const resetOnboarding = useOnboardingStore((s) => s.resetOnboarding)
  const [autoLaunch, setAutoLaunch] = React.useState(false)
  const [autoUpdate, setAutoUpdate] = React.useState(true)
  const [notifications, setNotifications] = React.useState(true)

  React.useEffect(() => {
    const loadSettings = async () => {
      const api = getElectronApi()
      if (isElectron() && api) {
        const [autoLaunchVal, autoUpdateVal, notificationsVal] =
          await Promise.all([
            api.getAutoLaunch(),
            api.getAutoUpdate(),
            api.getNotifications(),
          ])
        setAutoLaunch(autoLaunchVal)
        setAutoUpdate(autoUpdateVal)
        setNotifications(notificationsVal)
      }
    }
    loadSettings()
  }, [])

  const handleAutoLaunchChange = async (checked: boolean) => {
    setAutoLaunch(checked)
    const api = getElectronApi()
    if (isElectron() && api) {
      await api.setAutoLaunch(checked)
    }
  }

  const handleAutoUpdateChange = async (checked: boolean) => {
    setAutoUpdate(checked)
    const api = getElectronApi()
    if (isElectron() && api) {
      await api.setAutoUpdate(checked)
    }
  }

  const handleNotificationsChange = async (checked: boolean) => {
    setNotifications(checked)
    const api = getElectronApi()
    if (isElectron() && api) {
      await api.setNotifications(checked)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>外观设置</CardTitle>
          <CardDescription>选择应用的外观主题</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-3">
            <ThemeCard
              label="浅色"
              icon={IconSun}
              description="明亮的浅色背景"
              active={theme === "light"}
              onClick={() => setTheme("light")}
            />
            <ThemeCard
              label="深色"
              icon={IconMoon}
              description="暗色调护眼模式"
              active={theme === "dark"}
              onClick={() => setTheme("dark")}
            />
            <ThemeCard
              label="跟随系统"
              icon={IconDeviceDesktop}
              description="自动适配系统主题"
              active={theme === "system"}
              onClick={() => setTheme("system")}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>启动与更新</CardTitle>
          <CardDescription>配置应用启动和自动更新行为</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">开机自启动</span>
              <span className="text-xs text-muted-foreground">
                系统启动时自动打开应用
              </span>
            </div>
            <Switch
              checked={autoLaunch}
              onCheckedChange={handleAutoLaunchChange}
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">自动检查更新</span>
              <span className="text-xs text-muted-foreground">
                有新版本时自动提示
              </span>
            </div>
            <Switch
              checked={autoUpdate}
              onCheckedChange={handleAutoUpdateChange}
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">消息通知</span>
              <span className="text-xs text-muted-foreground">
                接收新消息时显示系统通知
              </span>
            </div>
            <Switch
              checked={notifications}
              onCheckedChange={handleNotificationsChange}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>新手引导</CardTitle>
          <CardDescription>重新查看应用核心功能的使用引导</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">重新查看引导</span>
              <span className="text-xs text-muted-foreground">
                重新播放应用核心功能的使用引导 <em>(重启应用后生效)</em>
              </span>
            </div>
            <Button variant="outline" size="sm" onClick={resetOnboarding}>
              <IconRocket className="mr-2 size-4" />
              重新查看引导
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
