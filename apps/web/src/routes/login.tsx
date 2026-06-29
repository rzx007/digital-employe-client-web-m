import { useState, useEffect, useRef } from "react"
import { decryptPwd } from "@/lib/password-sm"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Checkbox } from "@workspace/ui/components/checkbox"
import { cn } from "@workspace/ui/lib/utils"
import {
  IconEye,
  IconEyeOff,
  IconLoader2,
  IconSettings,
  IconX,
} from "@tabler/icons-react"
import { motion, AnimatePresence } from "motion/react"
import logoImage from "@/assets/logo.png"
import feishuIcon from "@/assets/feishu.svg"
import { useAuthStore } from "@/stores/auth-store"
import type { LoginUser } from "@/api/types"
import { EndpointConfig } from "@/components/login/endpoint-config"
import { ChangePasswordForm } from "@/components/login/change-password-form"
import { useEndpointStore } from "@/stores/endpoint-store"
import { updateRequestBaseUrl } from "@/lib/request"
import { getOAuthAuthorizeUrl } from "@/api/auth"
import {
  isElectron,
  subscribeElectron,
  withElectronApi,
} from "@/lib/electron/host"

export const Route = createFileRoute("/login")({
  component: LoginPage,
})

type LoginView = "login" | "endpoint" | "changePassword"

/* 登录窗内表单字段统一尺寸(基于 @workspace/ui 组件的 className 覆写) */
const FIELD_CLASS = "h-10 rounded-lg text-sm"
const LABEL_CLASS = "mb-2 text-[13px] font-semibold text-foreground"

const SUBVIEW_COPY: Record<
  Exclude<LoginView, "login">,
  { title: string; subtitle: string }
> = {
  endpoint: { title: "通信设置", subtitle: "配置后端服务通讯地址" },
  changePassword: { title: "修改密码", subtitle: "密码已过期，请设置新密码" },
}

const dragStyle = (on: boolean): React.CSSProperties =>
  on ? ({ WebkitAppRegion: "drag" } as React.CSSProperties) : {}
const noDrag = { WebkitAppRegion: "no-drag" } as React.CSSProperties

function LoginPage() {
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [rememberMe, setRememberMe] = useState(false)
  const [registerSuccessHint, setRegisterSuccessHint] = useState(false)
  const [currentView, setCurrentView] = useState<LoginView>("login")
  const { login, loading, error, clearError, isAuthenticated } = useAuthStore()
  const navigate = useNavigate()
  const inElectron = isElectron()

  const errorTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    if (error) {
      if (errorTimeoutRef.current) {
        clearTimeout(errorTimeoutRef.current)
      }
      errorTimeoutRef.current = setTimeout(() => {
        clearError()
      }, 2000)
    }
    return () => {
      if (errorTimeoutRef.current) {
        clearTimeout(errorTimeoutRef.current)
        errorTimeoutRef.current = null
      }
    }
  }, [error, clearError])

  useEffect(() => {
    if (!inElectron) return
    return subscribeElectron((api) =>
      api.onRegisterSuccess((registeredUsername: string) => {
        setUsername(registeredUsername)
        setRegisterSuccessHint(true)
      })
    )
  }, [inElectron])

  useEffect(() => {
    if (inElectron) return
    const handler = (e: StorageEvent) => {
      if (e.key === "register_success" && e.newValue) {
        setUsername(e.newValue)
        setRegisterSuccessHint(true)
        localStorage.removeItem("register_success")
      }
    }
    window.addEventListener("storage", handler)
    return () => window.removeEventListener("storage", handler)
  }, [inElectron])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    clearError()
    setRegisterSuccessHint(false)
    await login(username, decryptPwd(password), rememberMe)
    if (useAuthStore.getState().pendingPasswordChange) {
      setCurrentView("changePassword")
    }
  }

  useEffect(() => {
    if (!inElectron && isAuthenticated) {
      navigate({ to: "/" })
    }
  }, [isAuthenticated, inElectron, navigate])

  const handleEndpointSaved = () => {
    const baseUrl = useEndpointStore.getState().getBaseUrl()
    updateRequestBaseUrl(baseUrl)
    setCurrentView("login")
  }

  const handleChangePasswordSuccess = () => {
    setCurrentView("login")
    if (!inElectron) {
      navigate({ to: "/" })
    }
  }

  const handleChangePasswordCancel = () => {
    setCurrentView("login")
  }

  const handleOpenRegister = () => {
    if (inElectron) {
      void withElectronApi((api) => api.openRegister())
    } else {
      const width = 480
      const height = 700
      const left = window.screenX + (window.outerWidth - width) / 2
      const top = window.screenY + (window.outerHeight - height) / 2
      window.open(
        "/register",
        "register",
        `width=${width},height=${height},left=${left},top=${top},popup=yes`
      )
    }
  }

  const handleFeishuLogin = async () => {
    try {
      const res = await getOAuthAuthorizeUrl("feishu")
      const width = 600
      const height = 700
      const left = window.screenX + (window.outerWidth - width) / 2
      const top = window.screenY + (window.outerHeight - height) / 2
      window.open(
        res.url,
        "feishu_oauth",
        `width=${width},height=${height},left=${left},top=${top},popup=yes`
      )
    } catch (err) {
      console.error("获取飞书授权地址失败:", err)
    }
  }

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type !== "oauth_callback") return
      const payload = e.data.payload as {
        error?: string
        login?: { code?: number; token?: string; result?: LoginUser[] }
      }
      if (payload?.error) {
        console.error("飞书登录失败:", payload.error)
        useAuthStore.setState({ error: "飞书登录失败，请重试" })
        return
      }
      const login = payload?.login
      if (login?.token && login.result?.length) {
        void useAuthStore
          .getState()
          .loginWithToken(login.token, login.result[0])
      } else {
        useAuthStore.setState({ error: "飞书登录未返回有效凭证" })
      }
    }
    window.addEventListener("message", handler)
    return () => window.removeEventListener("message", handler)
  }, [])

  return (
    <div
      className={cn(
        "relative flex w-screen overflow-hidden",
        inElectron
          ? "h-screen flex-col bg-background"
          : "min-h-screen items-center justify-center bg-muted/40 px-4 py-10"
      )}
      style={dragStyle(inElectron)}
    >
      <div
        className={cn(
          "flex w-full flex-col",
          inElectron
            ? "h-full bg-background"
            : "max-w-[360px] rounded-2xl border border-border bg-card shadow-sm"
        )}
        style={noDrag}
      >
        {/* 顶栏:窗口控制(Electron 专属) + 拖拽手柄 */}
        <div
          className="flex h-11 shrink-0 items-center justify-between px-3"
          style={dragStyle(inElectron)}
        >
          {inElectron ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              title="通信设置"
              className="size-8 text-muted-foreground"
              style={noDrag}
              onClick={() =>
                setCurrentView(
                  currentView === "endpoint" ? "login" : "endpoint"
                )
              }
            >
              <IconSettings className="size-[18px]" />
            </Button>
          ) : (
            <span />
          )}

          {inElectron && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              title="关闭"
              className="size-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              style={noDrag}
              onClick={() => void withElectronApi((api) => api.quitApp())}
            >
              <IconX className="size-[18px]" />
            </Button>
          )}
        </div>

        {/* 主体 */}
        <div
          className={cn(
            "flex flex-1 flex-col px-7 pb-6",
            inElectron && "overflow-y-auto"
          )}
          style={noDrag}
        >
          {currentView === "endpoint" ? (
            <SubViewFrame copy={SUBVIEW_COPY.endpoint}>
              <EndpointConfig
                isElectron={inElectron}
                onCancel={() => setCurrentView("login")}
                onSaved={handleEndpointSaved}
              />
            </SubViewFrame>
          ) : (
            <AnimatePresence mode="wait" initial={false}>
              {currentView === "changePassword" ? (
                <motion.div
                  key="changePassword"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                >
                  <SubViewFrame copy={SUBVIEW_COPY.changePassword}>
                    <ChangePasswordForm
                      isElectron={inElectron}
                      onSuccess={handleChangePasswordSuccess}
                      onCancel={handleChangePasswordCancel}
                    />
                  </SubViewFrame>
                </motion.div>
              ) : (
                <motion.div
                  key="login"
                  className="flex flex-1 flex-col"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                >
                  {/* 品牌 —— 突出 logo 与名称 */}
                  <div
                    className="flex flex-col items-center pt-3.5 pb-6"
                    style={dragStyle(inElectron)}
                  >
                    <img
                      src={logoImage}
                      alt="数字员工"
                      className="h-[58px] w-auto object-contain"
                    />
                    <div className="mt-4 text-2xl font-bold tracking-[0.06em] text-foreground">
                      数字员工
                    </div>
                    <div className="mt-1.5 text-[11.5px] tracking-[0.34em] text-muted-foreground/70 uppercase">
                      Digital Employee
                    </div>
                  </div>

                  {registerSuccessHint && (
                    <div className="mb-3 flex items-center gap-2 rounded-lg border border-emerald-200/70 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-400">
                      <span className="inline-block size-1.5 shrink-0 rounded-full bg-emerald-500" />
                      注册成功，请登录
                    </div>
                  )}

                  <form onSubmit={handleSubmit}>
                    <Label htmlFor="username" className={LABEL_CLASS}>
                      账号
                    </Label>
                    <Input
                      id="username"
                      className={FIELD_CLASS}
                      type="text"
                      placeholder="请输入你的用户名"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      autoComplete="username"
                      disabled={loading}
                      autoFocus
                    />

                    <Label
                      htmlFor="password"
                      className={cn(LABEL_CLASS, "mt-4")}
                    >
                      密码
                    </Label>
                    <div className="relative">
                      <Input
                        id="password"
                        className={cn(FIELD_CLASS, "pr-10")}
                        type={showPassword ? "text" : "password"}
                        placeholder="初始密码 Aa123456"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        autoComplete="current-password"
                        disabled={loading}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        tabIndex={-1}
                        disabled={loading}
                        title={showPassword ? "隐藏密码" : "显示密码"}
                        className="absolute top-1/2 right-1 size-8 -translate-y-1/2 text-muted-foreground"
                        onClick={() => setShowPassword(!showPassword)}
                      >
                        {showPassword ? (
                          <IconEyeOff className="size-[18px]" />
                        ) : (
                          <IconEye className="size-[18px]" />
                        )}
                      </Button>
                    </div>

                    <div className="mt-3.5 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id="remember"
                          checked={rememberMe}
                          onCheckedChange={(checked) =>
                            setRememberMe(checked === true)
                          }
                          disabled={loading}
                        />
                        <Label
                          htmlFor="remember"
                          className="cursor-pointer text-[13px] font-normal text-muted-foreground"
                        >
                          记住密码
                        </Label>
                      </div>

                      <div className="flex items-center text-[13px] text-muted-foreground">
                        还没有账号？
                        <Button
                          type="button"
                          variant="link"
                          className="h-auto p-0 text-[13px] font-semibold"
                          onClick={handleOpenRegister}
                        >
                          去注册
                        </Button>
                      </div>
                    </div>

                    <Button
                      type="submit"
                      className="mt-[18px] h-10 w-full rounded-lg text-sm"
                      disabled={loading || !username || !password}
                    >
                      {loading && (
                        <IconLoader2 className="size-4 animate-spin" />
                      )}
                      {loading ? "登录中..." : "登录"}
                    </Button>
                  </form>

                  {error && (
                    <p className="mt-2.5 text-[12.5px] text-destructive">
                      {error}
                    </p>
                  )}

                  {/* 其他登录方式 */}
                  <div className="my-5 flex items-center gap-3">
                    <div className="h-px flex-1 bg-border" />
                    <span className="text-xs text-muted-foreground">
                      其他登录方式
                    </span>
                    <div className="h-px flex-1 bg-border" />
                  </div>

                  <div className="flex justify-center">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      title="飞书登录"
                      className="size-9 rounded-full"
                      disabled={loading}
                      onClick={handleFeishuLogin}
                    >
                      <img
                        src={feishuIcon}
                        alt="飞书"
                        className="size-[19px]"
                      />
                    </Button>
                  </div>

                  <div className="mt-auto pt-6 text-center text-[11px] text-muted-foreground/60">
                    上海博般技术数据有限公司
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          )}
        </div>
      </div>
    </div>
  )
}

/* 子视图(通信设置 / 修改密码)统一外壳:紧凑品牌 + 标题 */
function SubViewFrame({
  copy,
  children,
}: {
  copy: { title: string; subtitle: string }
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="flex items-center gap-2 pt-1.5 pb-4">
        <img
          src={logoImage}
          alt="数字员工"
          className="h-[22px] w-auto object-contain"
        />
        <span className="text-[15px] font-bold tracking-[0.04em] text-foreground">
          数字员工
        </span>
      </div>
      <div className="mb-4">
        <div className="text-lg font-bold text-foreground">{copy.title}</div>
        <div className="mt-1 text-[12.5px] text-muted-foreground">
          {copy.subtitle}
        </div>
      </div>
      {children}
    </div>
  )
}
