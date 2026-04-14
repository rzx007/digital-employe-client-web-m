import * as React from "react"
import pkg from "../../../package.json"
import logoSvg from '@/assets/logo.svg'
import {
  IconSettings,
  IconKeyboard,
  IconBrain,
  IconInfoCircle,
  IconLogout,
  IconRefresh,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { Separator } from "@workspace/ui/components/separator"
import { Switch } from "@workspace/ui/components/switch"
import { cn } from "@workspace/ui/lib/utils"
import { useTheme } from "@/components/theme-provider"
import { useAuthStore } from "@/stores/auth-store"
import { ScrollArea } from "@workspace/ui/components/scroll-area"

type SettingsTab = "general" | "shortcuts" | "models" | "about"

const tabs: {
  id: SettingsTab
  label: string
  icon: React.ComponentType<{ className?: string }>
}[] = [
    { id: "general", label: "通用", icon: IconSettings },
    { id: "shortcuts", label: "快捷键", icon: IconKeyboard },
    { id: "models", label: "模型", icon: IconBrain },
    { id: "about", label: "关于", icon: IconInfoCircle },
  ]

function ThemeCard({
  value,
  label,
  icon: Icon,
  description,
  active,
  onClick,
}: {
  value: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  description: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-col items-center gap-2 rounded-lg border-2 p-4 transition-colors hover:bg-accent/50",
        active ? "border-primary bg-primary/5" : "border-transparent"
      )}
    >
      <div
        className={cn(
          "flex size-10 items-center justify-center rounded-lg transition-colors",
          active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
        )}
      >
        <Icon className="size-5" />
      </div>
      <span className="text-sm font-medium">{label}</span>
      <span className="text-xs text-muted-foreground">{description}</span>
    </button>
  )
}

function GeneralSettings() {
  const { theme, setTheme } = useTheme()
  const logout = useAuthStore((s) => s.logout)
  const [autoLaunch, setAutoLaunch] = React.useState(false)
  const [autoUpdate, setAutoUpdate] = React.useState(true)
  const [notifications, setNotifications] = React.useState(true)

  React.useEffect(() => {
    const loadSettings = async () => {
      if (window.electronApi?.isElectron) {
        const [autoLaunchVal, autoUpdateVal, notificationsVal] = await Promise.all([
          window.electronApi.getAutoLaunch(),
          window.electronApi.getAutoUpdate(),
          window.electronApi.getNotifications(),
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
    if (window.electronApi?.isElectron) {
      await window.electronApi.setAutoLaunch(checked)
    }
  }

  const handleAutoUpdateChange = async (checked: boolean) => {
    setAutoUpdate(checked)
    if (window.electronApi?.isElectron) {
      await window.electronApi.setAutoUpdate(checked)
    }
  }

  const handleNotificationsChange = async (checked: boolean) => {
    setNotifications(checked)
    if (window.electronApi?.isElectron) {
      await window.electronApi.setNotifications(checked)
    }
  }

  const handleResetApp = async () => {
    if (window.electronApi?.isElectron) {
      await window.electronApi.resetApp()
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* 主题设置 */}
      <Card>
        <CardHeader>
          <CardTitle>外观设置</CardTitle>
          <CardDescription>选择应用的外观主题</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-3">
            <ThemeCard
              value="light"
              label="浅色"
              icon={IconSun}
              description="明亮的浅色背景"
              active={theme === "light"}
              onClick={() => setTheme("light")}
            />
            <ThemeCard
              value="dark"
              label="深色"
              icon={IconMoon}
              description="暗色调护眼模式"
              active={theme === "dark"}
              onClick={() => setTheme("dark")}
            />
            <ThemeCard
              value="system"
              label="跟随系统"
              icon={IconDeviceDesktop}
              description="自动适配系统主题"
              active={theme === "system"}
              onClick={() => setTheme("system")}
            />
          </div>
        </CardContent>
      </Card>

      {/* 启动与更新 */}
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

      {/* 退出登录 */}
      <Card>
        <CardHeader>
          <CardTitle>账号操作</CardTitle>
          <CardDescription>管理你的账号登录状态</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">退出登录</span>
              <span className="text-xs text-muted-foreground">
                退出当前账号，需要重新登录
              </span>
            </div>
            <Button variant="destructive" size="sm" onClick={logout}>
              <IconLogout className="mr-2 size-4" />
              退出登录
            </Button>
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium text-destructive">重置应用</span>
              <span className="text-xs text-muted-foreground">
                清除所有本地数据并恢复默认设置
              </span>
            </div>
            <Button variant="outline" size="sm" onClick={handleResetApp}>
              <IconRefresh className="mr-2 size-4" />
              重置应用
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function ShortcutsSettings() {
  const shortcuts = [
    { key: "Ctrl + K", action: "打开命令面板", category: "通用" },
    { key: "Ctrl + Enter", action: "发送消息", category: "通用" },
    { key: "Escape", action: "关闭弹窗", category: "通用" },
    { key: "Ctrl + I", action: "AI 助手对话", category: "通用" },
    { key: "Ctrl + ,", action: "打开设置", category: "通用" },
    { key: "Ctrl + N", action: "新建对话", category: "通用" },
    { key: "Ctrl + W", action: "关闭当前标签页", category: "通用" },
    { key: "F11", action: "全屏切换", category: "通用" },
  ]

  return (
    <Card>
      <CardHeader>
        <CardTitle>快捷键 <em className="text-xs ml-2 text-muted-foreground">开发中...</em></CardTitle>
        <CardDescription>应用支持的键盘快捷键</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3">
          {shortcuts.map((item) => (
            <div
              key={item.key}
              className="flex items-center justify-between rounded-md border p-3"
            >
              <span className="text-sm">{item.action}</span>
              <kbd className="rounded bg-muted px-2 py-1 text-xs font-mono">
                {item.key}
              </kbd>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function ModelsSettings() {
  const [model, setModel] = React.useState("")
  const [apiKey, setApiKey] = React.useState("")
  const [apiUrl, setApiUrl] = React.useState("")

  React.useEffect(() => {
    const loadModelSettings = async () => {
      if (window.electronApi?.isElectron) {
        const settings = await window.electronApi.getModelSettings()
        setModel(settings.model)
        setApiKey(settings.apiKey)
        setApiUrl(settings.apiUrl)
      }
    }
    loadModelSettings()
  }, [])

  const handleSave = async () => {
    if (window.electronApi?.isElectron) {
      await window.electronApi.setModelSettings({ model, apiKey, apiUrl })
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>模型设置<em className="text-xs ml-2 text-muted-foreground">开发中...</em></CardTitle>
        <CardDescription>配置 AI 模型相关选项</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">默认模型</span>
          <Select value={model} onValueChange={setModel}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="选择默认模型" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="claude">Claude 3.5 Sonnet</SelectItem>
              <SelectItem value="gpt4">GPT-4</SelectItem>
              <SelectItem value="gemini">Gemini Pro</SelectItem>
              <SelectItem value="deepseek">DeepSeek</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">API Key</span>
          <input
            type="password"
            placeholder="sk-..."
            className="rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">API 地址</span>
          <input
            placeholder="https://api.example.com"
            className="rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
            value={apiUrl}
            onChange={(e) => setApiUrl(e.target.value)}
          />
        </div>

        <Button onClick={handleSave} className="mt-2">
          保存设置
        </Button>
      </CardContent>
    </Card>
  )
}

function AboutSettings() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>关于</CardTitle>
        <CardDescription>应用信息</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {/* 品牌展示 */}
        <div className="flex flex-col items-center gap-3 py-4">
          <div className="flex size-16 items-center justify-center rounded-2xl text-2xl font-bold text-primary-foreground">
            <img src={logoSvg} className="size-10" />
          </div>
          <span className="text-xl font-semibold">DigitalEmployee</span>
          <span className="text-xs text-muted-foreground">
            数字员工智能助手
          </span>
        </div>

        <Separator />

        {/* 信息列表 */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">应用版本</span>
            <span className="text-sm font-medium font-mono">
              v{pkg.version}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">构建时间</span>
            <span className="text-sm font-medium font-mono">
              {typeof __BUILD_TIME__ !== "undefined" ? __BUILD_TIME__ : "-"}
            </span>
          </div>
        </div>



        {/* 操作 */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">检查更新</span>
            <Button variant="outline" size="sm" onClick={async () => {
              if (window.electronApi?.isElectron) {
                await window.electronApi.checkUpdate()
              }
            }}>
              检查更新
            </Button>
          </div>
        </div>

        <p className="text-xs text-center text-muted-foreground">
          © {new Date().getFullYear()} Bobandata. All rights reserved.
        </p>
      </CardContent>
    </Card>
  )
}

export function SettingsPage() {
  const [activeTab, setActiveTab] = React.useState<SettingsTab>("general")

  return (
    <div className="flex h-svh w-screen bg-background">
      {/* 左侧菜单 */}
      <div className="w-48 shrink-0 border-r bg-muted/50 p-4">
        <nav className="flex flex-col gap-1">
          {tabs.map((tab) => (
            <Button
              key={tab.id}
              variant={activeTab === tab.id ? "secondary" : "ghost"}
              className={cn(
                "justify-start gap-2 px-3",
                activeTab === tab.id && "bg-secondary"
              )}
              onClick={() => setActiveTab(tab.id)}
            >
              <tab.icon className="size-4" />
              {tab.label}
            </Button>
          ))}
        </nav>
      </div>

      {/* 右侧内容 */}
      <ScrollArea className="flex-1  p-6">
        {activeTab === "general" && <GeneralSettings />}
        {activeTab === "shortcuts" && <ShortcutsSettings />}
        {activeTab === "models" && <ModelsSettings />}
        {activeTab === "about" && <AboutSettings />}
      </ScrollArea>
    </div>
  )
}