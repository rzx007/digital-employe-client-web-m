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
import bgImage from "@/assets/Group.png"
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
      }),
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
        `width=${width},height=${height},left=${left},top=${top},popup=yes`,
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
        `width=${width},height=${height},left=${left},top=${top},popup=yes`,
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
        void useAuthStore.getState().loginWithToken(login.token, login.result[0])
      } else {
        useAuthStore.setState({ error: "飞书登录未返回有效凭证" })
      }
    }
    window.addEventListener("message", handler)
    return () => window.removeEventListener("message", handler)
  }, [])

  const rootStyle: React.CSSProperties = {
    background: `url(${bgImage}) no-repeat 100% 0%, linear-gradient(180deg, #eaf0fd 1%, rgba(236, 242, 255, 0.74) 27%, rgba(255, 255, 255, 0) 83%)`,
    ...(inElectron ? { WebkitAppRegion: "drag" } : {}),
  }

  return (
    <div
      className={cn(
        "relative w-screen overflow-hidden",
        inElectron ? "h-screen" : "min-h-screen px-4 py-10 md:px-6",
      )}
      style={rootStyle}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20">
        {inElectron && (
          <div
            className="pointer-events-auto absolute top-0 right-0 z-10 flex items-center"
            style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          >
            <button
              type="button"
              title="通信设置"
              className="p-2 text-gray-700 hover:bg-gray-300"
              onClick={() =>
                setCurrentView(
                  currentView === "endpoint" ? "login" : "endpoint",
                )
              }
            >
              <IconSettings className="size-5" />
            </button>
            <button
              type="button"
              title="关闭"
              className="p-2 text-gray-700 hover:bg-destructive hover:text-white"
              onClick={() => void withElectronApi((api) => api.quitApp())}
            >
              <IconX className="size-5" />
            </button>
          </div>
        )}

        <div
          className={cn(
            "pointer-events-auto select-none",
            inElectron
              ? "flex items-center px-4 pt-4"
              : "mx-auto flex w-full max-w-md items-center justify-center gap-2 pb-6",
          )}
        >
          <img src={logoImage} alt="DigitalEmployee" className="h-7 w-9" />
          <h1
            className={cn(
              "text-gray-800 tracking-wider",
              inElectron
                ? "ml-2 text-base font-semibold"
                : "text-xl font-semibold",
            )}
          >
            数字员工
          </h1>
        </div>
      </div>
      <div
        className={cn(
          inElectron
            ? "flex h-full items-center justify-center px-6 pt-14"
            : "mx-auto flex min-h-screen w-full max-w-md items-center justify-center pt-24",
        )}
      >
        <div
          className={cn(
            "w-full",
            inElectron
              ? "max-w-sm"
              : "rounded-2xl border border-border/60 bg-background/90 p-6 shadow-sm backdrop-blur md:p-8",
          )}
          style={
            inElectron
              ? ({ WebkitAppRegion: "no-drag" } as React.CSSProperties)
              : undefined
          }
        >
          {currentView === "endpoint" ? (
            <EndpointConfig
              key={currentView}
              isElectron={inElectron}
              onCancel={() => setCurrentView("login")}
              onSaved={handleEndpointSaved}
            />
          ) : (
            <AnimatePresence mode="wait" initial={false}>
              {currentView === "changePassword" ? (
                <motion.div
                  key="changePassword"
                  initial={{ x: 300, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  exit={{ x: -300, opacity: 0 }}
                  transition={{ duration: 0.3, ease: "easeInOut" }}
                >
                  <ChangePasswordForm
                    isElectron={inElectron}
                    onSuccess={handleChangePasswordSuccess}
                    onCancel={handleChangePasswordCancel}
                  />
                </motion.div>
              ) : (
                <motion.div
                  key="login"
                  initial={{ x: 300, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  exit={{ x: -300, opacity: 0 }}
                  transition={{ duration: 0.3, ease: "easeInOut" }}
                >
                  <h3
                    className={cn(
                      "font-bold",
                      inElectron ? "mb-6 text-xl" : "mb-8 text-2xl",
                    )}
                  >
                    欢迎回来
                  </h3>

                  {registerSuccessHint && (
                    <div className="mb-4 flex items-center gap-2 rounded-lg border border-emerald-200/80 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                      <span className="inline-block size-1.5 shrink-0 rounded-full bg-emerald-500" />
                      注册成功，请登录
                    </div>
                  )}

                  <form
                    onSubmit={handleSubmit}
                    className={cn(
                      "flex flex-col",
                      inElectron ? "gap-4" : "gap-5",
                    )}
                  >
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="username" className="text-sm font-bold">
                        账号
                      </Label>
                      <Input
                        id="username"
                        className="rounded-xs"
                        type="text"
                        placeholder="请输入你的用户名"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        autoComplete="username"
                        disabled={loading}
                        autoFocus
                      />
                    </div>

                    <div className="flex flex-col gap-1">
                      <Label htmlFor="password" className="text-sm font-bold">
                        密码
                      </Label>
                      <div className="relative">
                        <Input
                          id="password"
                          type={showPassword ? "text" : "password"}
                          placeholder="初始密码 Aa123456"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          className="pr-8 rounded-xs"
                          autoComplete="current-password"
                          disabled={loading}
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground disabled:cursor-not-allowed"
                          tabIndex={-1}
                          disabled={loading}
                        >
                          {showPassword ? (
                            <IconEyeOff className="size-3.5" />
                          ) : (
                            <IconEye className="size-3.5" />
                          )}
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center justify-between py-1">
                      <div className="flex items-center gap-1">
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
                          className="cursor-pointer text-xs"
                        >
                          记住密码
                        </Label>
                      </div>
                      <div className="flex items-center gap-x-1 text-xs">
                        <span className="text-muted-foreground">
                          还没有账号？
                        </span>
                        <button
                          type="button"
                          onClick={handleOpenRegister}
                          className="font-medium text-primary underline decoration-primary/25 underline-offset-4 transition hover:decoration-primary"
                        >
                          去注册
                        </button>
                      </div>
                    </div>

                    <Button
                      type="submit"
                      className="w-full"
                      size={inElectron ? "lg" : "default"}
                      disabled={loading || !username || !password}
                    >
                      {loading && (
                        <IconLoader2 className="mr-2 size-4 animate-spin" />
                      )}
                      {loading ? "登录中..." : "登录"}
                    </Button>
                  </form>
                  {error && (
                    <p className="mt-2 text-xs text-destructive">{error}</p>
                  )}
                  <div className="mt-4">
                    <div className="relative">
                      <div className="absolute inset-0 flex items-center">
                        <span className="w-full border-t" />
                      </div>
                      <div className="relative flex justify-center text-xs uppercase">
                        <span className="bg-background px-2 text-muted-foreground">
                          其他登录方式
                        </span>
                      </div>
                    </div>
                    <div className="mt-4 flex justify-center gap-4">
                      <button
                        type="button"
                        onClick={handleFeishuLogin}
                        disabled={loading}
                        className="flex size-9 cursor-pointer items-center justify-center rounded-full border bg-background transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                        title="飞书登录"
                      >
                        <img
                          src={feishuIcon}
                          alt="飞书"
                          className="size-6"
                        />
                      </button>
                    </div>
                  </div>
                  <div
                    className={cn(
                      "w-full text-center",
                      inElectron ? "mt-2" : "mt-4",
                    )}
                  >
                    <p className="mt-2 text-[11px] text-muted-foreground/50">
                      上海博般技术数据有限公司
                    </p>
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
