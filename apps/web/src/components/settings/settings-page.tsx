import * as React from "react"
import pkg from "../../../package.json"
import logoSvg from '@/assets/logo.svg'
import Avatar1 from "@/assets/avaters/1.png"
import Avatar2 from "@/assets/avaters/2.png"
import Avatar3 from "@/assets/avaters/3.png"
import Avatar4 from "@/assets/avaters/4.png"
import Avatar5 from "@/assets/avaters/5.png"
import Avatar6 from "@/assets/avaters/6.png"
import Avatar7 from "@/assets/avaters/7.png"
import Avatar8 from "@/assets/avaters/8.png"
import Avatar9 from "@/assets/avaters/9.png"
import {
  IconSettings,
  IconKeyboard,
  IconBrain,
  IconInfoCircle,
  IconLogout,
  IconSun,
  IconMoon,
  IconDeviceDesktop,
  IconRocket,
  IconUser,
  IconLock,
  IconTrash,
} from "@tabler/icons-react"
import { toast } from "sonner"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
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
import { updatePassword } from "@/api/auth"
import { decryptPwd } from "@/lib/password-sm"

type SettingsTab = "account" | "general" | "shortcuts" | "models" | "about"

const tabs: {
  id: SettingsTab
  label: string
  icon: React.ComponentType<{ className?: string }>
}[] = [
    { id: "account", label: "账号与隐私", icon: IconUser },
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

const userAvatars = [
  Avatar1, Avatar2, Avatar3, Avatar4, Avatar5,
  Avatar6, Avatar7, Avatar8, Avatar9, Avatar1,
]

function ChangePasswordDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)
  const [oldPwd, setOldPwd] = React.useState("")
  const [newPwd, setNewPwd] = React.useState("")
  const [confirmPwd, setConfirmPwd] = React.useState("")
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [submitting, setSubmitting] = React.useState(false)

  const validate = (): boolean => {
    const errs: Record<string, string> = {}
    if (!oldPwd) errs.oldPwd = "旧密码不可为空"
    if (!newPwd) {
      errs.newPwd = "新密码不可为空"
    } else if (newPwd.length < 8 || newPwd.length > 15) {
      errs.newPwd = "密码长度需在8-15位之间"
    } else {
      const hasUpper = /[A-Z]/.test(newPwd)
      const hasLower = /[a-z]/.test(newPwd)
      const hasNumber = /[0-9]/.test(newPwd)
      const hasSpecial = /[^A-Za-z0-9]/.test(newPwd)
      const typeCount = [hasUpper, hasLower, hasNumber, hasSpecial].filter(Boolean).length
      if (typeCount < 3) errs.newPwd = "密码需包含大写字母、小写字母、数字、特殊字符中至少三种"
      if (user?.username && newPwd.includes(user.username)) errs.newPwd = "密码不能包含用户名"
    }
    if (!confirmPwd) {
      errs.confirmPwd = "确认密码不可为空"
    } else if (newPwd !== confirmPwd) {
      errs.confirmPwd = "两次输入的密码不一致"
    }
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  const handleSubmit = async () => {
    if (!validate() || !user?.id) return
    setSubmitting(true)
    try {
      const res = await updatePassword({
        id: user.id,
        oldPassword: decryptPwd(oldPwd),
        password: decryptPwd(newPwd),
      })
      if (res.data?.code === 1) {
        toast.success("密码修改成功，请重新登录")
        onOpenChange(false)
        setOldPwd("")
        setNewPwd("")
        setConfirmPwd("")
        logout()
      } else {
        toast.error(res.data?.msg || "密码修改失败")
      }
    } catch {
      toast.error("密码修改失败")
    } finally {
      setSubmitting(false)
    }
  }

  const handleClose = (v: boolean) => {
    if (!v) {
      setOldPwd("")
      setNewPwd("")
      setConfirmPwd("")
      setErrors({})
    }
    onOpenChange(v)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>修改密码</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="old-pwd">旧密码</Label>
            <Input
              id="old-pwd"
              type="password"
              placeholder="请输入旧密码"
              value={oldPwd}
              onChange={(e) => setOldPwd(e.target.value)}
            />
            {errors.oldPwd && (
              <p className="text-xs text-destructive">{errors.oldPwd}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-pwd">新密码</Label>
            <Input
              id="new-pwd"
              type="password"
              placeholder="8-15位，包含至少三种字符类型"
              value={newPwd}
              onChange={(e) => setNewPwd(e.target.value)}
            />
            {errors.newPwd && (
              <p className="text-xs text-destructive">{errors.newPwd}</p>
            )}
            <p className="text-xs text-muted-foreground">
              密码需包含大写字母、小写字母、数字、特殊字符中至少三种
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm-pwd">确认新密码</Label>
            <Input
              id="confirm-pwd"
              type="password"
              placeholder="请再次输入新密码"
              value={confirmPwd}
              onChange={(e) => setConfirmPwd(e.target.value)}
            />
            {errors.confirmPwd && (
              <p className="text-xs text-destructive">{errors.confirmPwd}</p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? "保存中..." : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AccountSettings() {
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)
  const restoreSession = useAuthStore((s) => s.restoreSession)
  const [pwdDialogOpen, setPwdDialogOpen] = React.useState(false)
  React.useEffect(() => {
    (async () => {
      await restoreSession()
    })()
  }, [restoreSession])

  const avatarIndex = user?.id ? parseInt(user.id.toString()) % 10 : 0
  const department = user?.dpts?.[0]?.name

  return (
    <>
      <ChangePasswordDialog
        open={pwdDialogOpen}
        onOpenChange={setPwdDialogOpen}
      />
      <div className="flex flex-col gap-5">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4 mb-6">
              <div className="size-16 overflow-hidden rounded-full">
                <img
                  src={userAvatars[avatarIndex]}
                  alt={user?.name || "用户"}
                  className="size-full object-cover"
                />
              </div>
              <div>
                <h3 className="text-xl font-medium">
                  {user?.name || "未知用户"}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {department || "未知部门"}
                </p>
              </div>
            </div>

            <h3 className="mb-4 text-sm font-medium">账号信息</h3>

            <div className="space-y-4">
              <div className="flex items-center">
                <div className="w-20 shrink-0">
                  <Label>用户名</Label>
                </div>
                <p
                  className={cn(
                    "text-sm",
                    !user?.username && "text-muted-foreground"
                  )}
                >
                  {user?.username || "未知用户"}
                </p>
              </div>

              <div className="flex items-center">
                <div className="w-20 shrink-0">
                  <Label>手机号</Label>
                </div>
                <p
                  className={cn(
                    "text-sm",
                    !user?.phoneNumber && "text-muted-foreground"
                  )}
                >
                  {user?.phoneNumber || "尚未绑定"}
                </p>
              </div>

              <div className="flex items-center">
                <div className="w-20 shrink-0">
                  <Label>邮箱</Label>
                </div>
                <p
                  className={cn(
                    "text-sm",
                    !user?.email && "text-muted-foreground"
                  )}
                >
                  {user?.email || "尚未绑定"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>账号安全</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <p className="text-sm font-medium">密码修改</p>
                <p className="text-xs text-muted-foreground">
                  密码修改后，您需要重新登录。
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPwdDialogOpen(true)}
              >
                <IconLock className="mr-2 size-4" />
                修改密码
              </Button>
            </div>

            <Separator />

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <p className="text-sm font-medium">退出登录</p>
                <p className="text-xs text-muted-foreground">
                  退出当前登录账号。
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={logout}>
                <IconLogout className="mr-2 size-4" />
                退出登录
              </Button>
            </div>

            <Separator />

            <div className="flex cursor-not-allowed items-center justify-between opacity-55">
              <div className="space-y-0.5">
                <p className="text-sm font-medium">注销账号</p>
                <p className="text-xs text-red-500">
                  注销账号不可恢复，所有数据将被删除。
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled
                className="border-red-200 text-red-500 hover:bg-red-100 hover:text-red-600"
              >
                <IconTrash className="mr-2 size-4" />
                注销账号
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  )
}

function GeneralSettings() {
  const { theme, setTheme } = useTheme()
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
        {activeTab === "account" && <AccountSettings />}
        {activeTab === "general" && <GeneralSettings />}
        {activeTab === "shortcuts" && <ShortcutsSettings />}
        {activeTab === "models" && <ModelsSettings />}
        {activeTab === "about" && <AboutSettings />}
      </ScrollArea>
    </div>
  )
}