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
import { useAuthStore } from "@/stores/auth-store"
import { EndpointConfig } from "@/components/login/endpoint-config"
import { ChangePasswordForm } from "@/components/login/change-password-form"
import { useEndpointStore } from "@/stores/endpoint-store"
import { updateRequestBaseUrl } from "@/lib/request"

export const Route = createFileRoute("/login")({
  component: LoginPage,
})

type LoginView = "login" | "endpoint" | "changePassword"

function LoginPage() {
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [rememberMe, setRememberMe] = useState(false)
  const [currentView, setCurrentView] = useState<LoginView>("login")
  const {
    login,
    loading,
    error,
    clearError,
    isAuthenticated,
    pendingPasswordChange,
  } = useAuthStore()
  const navigate = useNavigate()

  // 用于保存定时器引用，避免内存泄漏
  const errorTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // 当error存在时，2秒后自动清除
  useEffect(() => {
    if (error) {
      // 清除之前的定时器
      if (errorTimeoutRef.current) {
        clearTimeout(errorTimeoutRef.current)
      }
      // 设置新的定时器
      errorTimeoutRef.current = setTimeout(() => {
        clearError()
      }, 2000)
    }

    // 组件卸载或重新渲染时清除定时器
    return () => {
      if (errorTimeoutRef.current) {
        clearTimeout(errorTimeoutRef.current)
        errorTimeoutRef.current = null
      }
    }
  }, [error, clearError])

  // 检测 pendingPasswordChange，自动切换到修改密码视图
  useEffect(() => {
    if (pendingPasswordChange && currentView === "login") {
      setCurrentView("changePassword")
    }
  }, [pendingPasswordChange, currentView])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    clearError()
    await login(username, decryptPwd(password), rememberMe)
  }

  const isElectron = !!window.electronApi

  useEffect(() => {
    if (!isElectron && isAuthenticated) {
      navigate({ to: "/" })
    }
  }, [isAuthenticated, isElectron, navigate])

  const handleEndpointSaved = () => {
    const baseUrl = useEndpointStore.getState().getBaseUrl()
    updateRequestBaseUrl(baseUrl)
    setCurrentView("login")
  }

  const handleChangePasswordSuccess = () => {
    setCurrentView("login")
    if (!isElectron) {
      navigate({ to: "/" })
    }
  }

  const handleChangePasswordCancel = () => {
    setCurrentView("login")
  }

  const rootStyle: React.CSSProperties = {
    background: `url(${bgImage}) no-repeat 100% 0%, linear-gradient(180deg, #eaf0fd 1%, rgba(236, 242, 255, 0.74) 27%, rgba(255, 255, 255, 0) 83%)`,
    ...(isElectron ? { WebkitAppRegion: "drag" } : {}),
  }

  return (
    <div
      className={cn(
        "relative w-screen overflow-hidden",
        isElectron
          ? "h-screen"
          : "flex min-h-screen flex-col items-center justify-center px-4 py-10 md:px-6"
      )}
      style={rootStyle}
    >
      <div>
        {/* 右上角按钮 */}
        {isElectron && (
          <div
            className="absolute top-0 right-0 z-10 flex items-center"
            style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          >
            <button
              type="button"
              title="通信设置"
              className="p-2 text-gray-700 hover:bg-gray-300"
              onClick={() =>
                setCurrentView(currentView === "endpoint" ? "login" : "endpoint")
              }
            >
              <IconSettings className="size-5" />
            </button>
            <button
              type="button"
              title="关闭"
              className="p-2 text-gray-700 hover:bg-destructive hover:text-white"
              onClick={() => window.electronApi?.quitApp()}
            >
              <IconX className="size-5" />
            </button>
          </div>
        )}

        {/* Logo + 名称 */}
        <div
          className={cn(
            "select-none",
            isElectron
              ? "flex items-center px-4 pt-4"
              : "mx-auto flex w-full max-w-md items-center justify-center gap-2 pb-6"
          )}
        >
          <img src={logoImage} alt="DigitalEmployee" className="h-7 w-9" />
          <h1
            className={cn(
              "text-gray-800 tracking-wider",
              isElectron ? "ml-2 text-base font-semibold" : "text-xl font-semibold"
            )}
          >
            数字员工
          </h1>
        </div>
      </div>
      {currentView === "endpoint" ? (
        <div
          className={cn(
            "mx-auto w-full",
            isElectron
              ? "max-w-sm px-6 "
              : "max-w-md rounded-2xl border border-border/60 bg-background/90 p-6 shadow-sm backdrop-blur md:p-8"
          )}
        >
          <EndpointConfig
            isElectron={isElectron}
            onCancel={() => setCurrentView("login")}
            onSaved={handleEndpointSaved}
          />
        </div>
      ) : (
        <div
          className={cn(
            isElectron
              ? "flex flex-col items-center justify-center px-6 pt-10"
              : "mx-auto flex w-full max-w-md justify-center"
          )}
        >
          <div
            className={cn(
              "w-full",
              isElectron
                ? "max-w-sm"
                : "rounded-2xl border border-border/60 bg-background/90 p-6 shadow-sm backdrop-blur md:p-8"
            )}
            style={
              isElectron
                ? ({ WebkitAppRegion: "no-drag" } as React.CSSProperties)
                : undefined
            }
          >
            <AnimatePresence mode="wait">
              {currentView === "changePassword" ? (
                <motion.div
                  key="changePassword"
                  initial={{ x: 300, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  exit={{ x: -300, opacity: 0 }}
                  transition={{ duration: 0.3, ease: "easeInOut" }}
                >
                  <ChangePasswordForm
                    isElectron={isElectron}
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
                      isElectron ? "mb-6 text-xl" : "mb-8 text-2xl"
                    )}
                  >
                    欢迎回来
                  </h3>

                  <form
                    onSubmit={handleSubmit}
                    className={cn("flex flex-col", isElectron ? "gap-4" : "gap-5")}
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
                          placeholder="请输入你的密码"
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

                    <div className="flex items-center gap-4 py-1">
                      <div className="flex items-center gap-1">
                        <Checkbox
                          id="remember"
                          checked={rememberMe}
                          onCheckedChange={(checked) =>
                            setRememberMe(checked === true)
                          }
                          disabled={loading}
                        />
                        <Label htmlFor="remember" className="cursor-pointer text-sm">
                          记住密码
                        </Label>
                      </div>
                    </div>

                    <Button
                      type="submit"
                      className="w-full"
                      size={isElectron ? "lg" : "default"}
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
                  <div
                    className={cn(
                      "w-full text-center",
                      isElectron ? "mt-2" : "mt-4"
                    )}
                  >
                    <p className="text-xs text-muted-foreground">
                      还没有账号?{" "}
                      <span className="cursor-pointer text-primary">注册</span>
                    </p>
                    <p className="mt-2 text-[11px] text-muted-foreground/50">
                      上海博般技术数据有限公司
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      )}
    </div>
  )
}
