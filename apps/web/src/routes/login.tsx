import { useState, useEffect, useRef, useLayoutEffect } from "react"
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
import { EndpointConfig } from "@/components/login/endpoint-config"
import { ChangePasswordForm } from "@/components/login/change-password-form"
import { useEndpointStore } from "@/stores/endpoint-store"
import { updateRequestBaseUrl } from "@/lib/request"
import { getOAuthAuthorizeUrl, registerApi } from "@/api/auth"
import { getDeptTree } from "@/api/dept"
import { togglePath, type DeptTreeNode } from "@/lib/dept-tree"
import { RegisterDeptTree } from "@/components/login/register-dept-tree"

export const Route = createFileRoute("/login")({
  component: LoginPage,
})

type LoginView = "login" | "endpoint" | "changePassword"
type AuthTab = "login" | "register"

/** 隐藏滚动条样式（仍可滚轮滚动） */
const hideScrollbar =
  "[scrollbar-width:none] [&::-webkit-scrollbar]:w-0 [&::-webkit-scrollbar]:h-0"

function LoginPage() {
  const [authTab, setAuthTab] = useState<AuthTab>("login")
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [rememberMe, setRememberMe] = useState(false)
  const [regUsername, setRegUsername] = useState("")
  const [regPassword, setRegPassword] = useState("")
  const [showRegPassword, setShowRegPassword] = useState(false)
  const [regPhone, setRegPhone] = useState("")
  const [regName, setRegName] = useState("")
  const [registerLoading, setRegisterLoading] = useState(false)
  const [registerError, setRegisterError] = useState<string | null>(null)
  const [selectedDeptPaths, setSelectedDeptPaths] = useState<number[][]>([])
  const [deptNodes, setDeptNodes] = useState<DeptTreeNode[]>([])
  const [deptLoading, setDeptLoading] = useState(false)
  const [deptFetchError, setDeptFetchError] = useState<string | null>(null)
  const [registerSuccessHint, setRegisterSuccessHint] = useState(false)
  /** 通讯配置保存后递增，用于注册 Tab 重新拉取部门树 */
  const [deptRefreshEpoch, setDeptRefreshEpoch] = useState(0)
  const [currentView, setCurrentView] = useState<LoginView>("login")
  const { login, loading, error, clearError, isAuthenticated } = useAuthStore()
  const navigate = useNavigate()
  const isElectron = !!window.electronApi
  const loginShellRef = useRef<HTMLDivElement>(null)
  /** Electron：按中间内容列实际高度量窗，避免 shell.scrollHeight 贴近视口高度造成底部留白 */
  const loginColumnRef = useRef<HTMLDivElement>(null)

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

  useEffect(() => {
    if (authTab !== "register") return
    let cancelled = false
    setDeptLoading(true)
    setDeptFetchError(null)
    getDeptTree()
      .then(({ code, msg, nodes }) => {
        if (cancelled) return
        setDeptNodes(nodes)
        if (nodes.length === 0 && code !== 1) {
          setDeptFetchError(msg || "部门数据加载失败")
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setDeptFetchError(
            err instanceof Error ? err.message : "部门数据加载失败",
          )
        }
      })
      .finally(() => {
        if (!cancelled) setDeptLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [authTab, deptRefreshEpoch])

  useLayoutEffect(() => {
    if (!isElectron || !window.electronApi?.resizeLoginWindow) return
    const shell = loginShellRef.current
    if (!shell) return

    const LOGIN_W = 400
    const maxPx = Math.floor(window.screen.availHeight * 0.92)

    const measureHeight = (): number => {
      const column = loginColumnRef.current
      if (column) {
        const cs = getComputedStyle(shell)
        const pt = Number.parseFloat(cs.paddingTop) || 0
        const pb = Number.parseFloat(cs.paddingBottom) || 0
        return Math.ceil(column.offsetHeight + pt + pb + 6)
      }
      return Math.ceil(shell.scrollHeight + 8)
    }

    const apply = () => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const natural = measureHeight()
          const h = Math.min(Math.max(natural, 260), maxPx)
          void window.electronApi!.resizeLoginWindow!({
            width: LOGIN_W,
            height: h,
          })
        })
      })
    }

    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(shell)
    const col = loginColumnRef.current
    if (col) ro.observe(col)

    return () => ro.disconnect()
  }, [isElectron, currentView, authTab, loading, registerLoading])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    clearError()
    setRegisterSuccessHint(false)
    await login(username, decryptPwd(password), rememberMe)
    if (useAuthStore.getState().pendingPasswordChange) {
      setCurrentView("changePassword")
    }
  }

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setRegisterError(null)
    setRegisterSuccessHint(false)
    const phone = regPhone.trim()
    if (!/^1\d{10}$/.test(phone)) {
      setRegisterError("请输入有效的 11 位手机号")
      return
    }
    if (selectedDeptPaths.length === 0) {
      setRegisterError("请选择所属部门")
      return
    }
    setRegisterLoading(true)
    try {
      const res = await registerApi({
        username: regUsername.trim(),
        password: decryptPwd(regPassword),
        phoneNumber: phone,
        name: regName.trim(),
        departmentIds: selectedDeptPaths,
      })
      if (res.code === 1) {
        setUsername(regUsername.trim())
        setRegUsername("")
        setRegPassword("")
        setRegPhone("")
        setRegName("")
        setSelectedDeptPaths([])
        setAuthTab("login")
        setRegisterSuccessHint(true)
      } else {
        setRegisterError(res.msg || "注册失败")
      }
    } catch (err) {
      setRegisterError(
        err instanceof Error ? err.message : "网络异常，请稍后重试"
      )
    } finally {
      setRegisterLoading(false)
    }
  }

  useEffect(() => {
    if (!isElectron && isAuthenticated) {
      navigate({ to: "/" })
    }
  }, [isAuthenticated, isElectron, navigate])

  const syncRemoteApiBaseFromStore = () => {
    const baseUrl = useEndpointStore.getState().getBaseUrl()
    updateRequestBaseUrl(baseUrl)
    setSelectedDeptPaths([])
    setDeptRefreshEpoch((n) => n + 1)
  }

  const handleEndpointSaved = () => {
    syncRemoteApiBaseFromStore()
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

  const switchAuthView = (tab: AuthTab) => {
    setAuthTab(tab)
    clearError()
    setRegisterError(null)
    setRegisterSuccessHint(false)
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
      if (e.data?.type === "oauth_callback") {
        console.log("OAuth result:", e.data.payload)
      }
    }
    window.addEventListener("message", handler)
    return () => window.removeEventListener("message", handler)
  }, [])

  const rootStyle: React.CSSProperties = {
    background: `url(${bgImage}) no-repeat 100% 0%, linear-gradient(180deg, #eaf0fd 1%, rgba(236, 242, 255, 0.74) 27%, rgba(255, 255, 255, 0) 83%)`,
    ...(isElectron ? { WebkitAppRegion: "drag" } : {}),
  }

  return (
    <div
      className={cn(
        "relative flex w-screen flex-col",
        isElectron
          ? "min-h-min w-full overflow-x-hidden"
          : "min-h-dvh overflow-hidden",
      )}
      style={rootStyle}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20">
        {/* 右上角按钮 */}
        {isElectron && (
          <div
            className="pointer-events-auto absolute top-0 right-0 z-10 flex items-center"
            style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          >
            <button
              type="button"
              title="通信设置"
              className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground"
              onClick={() =>
                setCurrentView(currentView === "endpoint" ? "login" : "endpoint")
              }
            >
              <IconSettings className="size-5" />
            </button>
            <button
              type="button"
              title="关闭"
              className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-destructive hover:text-destructive-foreground"
              onClick={() => window.electronApi?.quitApp()}
            >
              <IconX className="size-5" />
            </button>
          </div>
        )}

        {/* Logo + 名称 */}
        <div
          className={cn(
            "pointer-events-auto select-none",
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
      <div
        ref={isElectron ? loginShellRef : undefined}
        className={cn(
          isElectron
            ? cn(
                "flex w-full flex-col overflow-x-hidden px-6 pb-3 pt-12",
              )
            : "flex min-h-0 flex-1 flex-col justify-center px-4 pb-6 pt-20 md:px-6",
        )}
      >
        <div
          ref={isElectron ? loginColumnRef : undefined}
          className={cn(
            "flex min-h-0 w-full flex-col",
            isElectron
              ? "mx-auto max-w-sm"
              : "mx-auto max-h-[min(100dvh-2rem,920px)] w-full max-w-md overflow-hidden rounded-2xl border border-border/50 bg-background/95 shadow-md ring-1 ring-border/20 backdrop-blur-sm",
          )}
          style={
            isElectron
              ? ({ WebkitAppRegion: "no-drag" } as React.CSSProperties)
              : undefined
          }
        >
          <div
            className={cn(
              isElectron
                ? "flex w-full flex-col overflow-x-hidden"
                : cn(
                    "flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto overscroll-contain",
                    hideScrollbar,
                    "p-5 md:p-7",
                  ),
            )}
          >
          {currentView === "endpoint" ? (
            <EndpointConfig
              isElectron={isElectron}
              onCancel={() => setCurrentView("login")}
              onKvPersisted={syncRemoteApiBaseFromStore}
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
                  <AnimatePresence mode="wait" initial={false}>
                    {authTab === "login" ? (
                      <motion.div
                        key="login-form"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={{ duration: 0.2, ease: "easeOut" }}
                        className="w-full"
                      >
                      <div className="mb-6 space-y-1 md:mb-8">
                        <h3 className="text-xl font-semibold tracking-tight text-foreground md:text-2xl">
                          欢迎回来
                        </h3>
                        <p className="text-sm text-muted-foreground">
                          登录以继续使用数字员工
                        </p>
                      </div>
                      {registerSuccessHint && (
                        <div
                          className="mb-5 flex items-center gap-2 rounded-lg border border-emerald-200/80 bg-emerald-50 px-3 py-2.5 text-xs text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/50 dark:text-emerald-200"
                          role="status"
                        >
                          <span className="inline-block size-1.5 shrink-0 rounded-full bg-emerald-500" />
                          注册成功，请登录
                        </div>
                      )}

                      <form
                        onSubmit={handleSubmit}
                        className={cn(
                          "flex flex-col",
                          isElectron ? "gap-4" : "gap-5"
                        )}
                      >
                        <div className="flex flex-col gap-1.5">
                          <Label
                            htmlFor="username"
                            className="text-sm font-medium text-foreground"
                          >
                            账号
                          </Label>
                          <Input
                            id="username"
                            className="h-10 rounded-md border-border/80 bg-background transition-shadow focus-visible:ring-2 focus-visible:ring-primary/20"
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
                          <Label
                            htmlFor="password"
                            className="text-sm font-medium text-foreground"
                          >
                            密码
                          </Label>
                          <div className="relative">
                            <Input
                              id="password"
                              type={showPassword ? "text" : "password"}
                              placeholder="初始密码 Aa123456"
                              value={password}
                              onChange={(e) => setPassword(e.target.value)}
                              className="h-10 rounded-md border-border/80 bg-background pr-8 transition-shadow focus-visible:ring-2 focus-visible:ring-primary/20"
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
                            <Label
                              htmlFor="remember"
                              className="cursor-pointer text-sm"
                            >
                              记住密码
                            </Label>
                          </div>
                        </div>

                        <Button
                          type="submit"
                          className="w-full font-medium shadow-sm"
                          size={isElectron ? "lg" : "default"}
                          disabled={loading || !username || !password}
                        >
                          {loading && (
                            <IconLoader2 className="mr-2 size-4 animate-spin" />
                          )}
                          {loading ? "登录中..." : "登录"}
                        </Button>
                        <div className="mt-4 flex flex-wrap items-center justify-center gap-x-1 gap-y-0.5 text-sm">
                          <span className="text-muted-foreground">还没有账号？</span>
                          <button
                            type="button"
                            onClick={() => switchAuthView("register")}
                            className="font-medium text-primary underline decoration-primary/25 underline-offset-4 transition hover:decoration-primary"
                          >
                            去注册
                          </button>
                        </div>
                      </form>
                      {error && (
                        <p
                          className="mt-3 rounded-md bg-destructive/10 px-2 py-1.5 text-xs text-destructive"
                          role="alert"
                        >
                          {error}
                        </p>
                      )}
                      <div className="mt-7">
                        <div className="relative">
                          <div className="absolute inset-0 flex items-center">
                            <span className="w-full border-t border-border/70" />
                          </div>
                          <div className="relative flex justify-center text-[11px] font-medium tracking-wide text-muted-foreground">
                            <span className="bg-background px-3 text-muted-foreground/90">
                              其他登录方式
                            </span>
                          </div>
                        </div>
                        <div className="mt-4 flex justify-center gap-4">
                          <button
                            type="button"
                            onClick={handleFeishuLogin}
                            disabled={loading}
                            className="flex size-10 cursor-pointer items-center justify-center rounded-full border border-border/80 bg-background shadow-sm transition-all hover:border-primary/25 hover:bg-muted/60 hover:shadow disabled:cursor-not-allowed disabled:opacity-50"
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
                      </motion.div>
                    ) : (
                      <motion.div
                        key="register-form"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={{ duration: 0.2, ease: "easeOut" }}
                        className="w-full"
                      >
                      <div className="mb-5 space-y-1 md:mb-6">
                        <h3 className="text-xl font-semibold tracking-tight text-foreground md:text-2xl">
                          创建账号
                        </h3>
                        <p className="text-sm text-muted-foreground">
                          填写以下信息完成注册
                        </p>
                      </div>

                      <form
                        onSubmit={handleRegisterSubmit}
                        className={cn(
                          "flex flex-col",
                          isElectron ? "gap-3" : "gap-3.5",
                        )}
                      >
                        <div className="flex flex-col gap-1.5">
                          <Label
                            htmlFor="reg-username"
                            className="text-sm font-medium text-foreground"
                          >
                            用户名
                          </Label>
                          <Input
                            id="reg-username"
                            className="h-10 rounded-md border-border/80 bg-background transition-shadow focus-visible:ring-2 focus-visible:ring-primary/20"
                            type="text"
                            placeholder="登录用户名"
                            value={regUsername}
                            onChange={(e) => setRegUsername(e.target.value)}
                            autoComplete="username"
                            disabled={registerLoading}
                            autoFocus
                          />
                        </div>

                        <div className="flex flex-col gap-1">
                          <Label
                            htmlFor="reg-password"
                            className="text-sm font-medium text-foreground"
                          >
                            密码
                          </Label>
                          <div className="relative">
                            <Input
                              id="reg-password"
                              type={showRegPassword ? "text" : "password"}
                              placeholder="与登录相同的密码规则"
                              value={regPassword}
                              onChange={(e) => setRegPassword(e.target.value)}
                              className="h-10 rounded-md border-border/80 bg-background pr-8 transition-shadow focus-visible:ring-2 focus-visible:ring-primary/20"
                              autoComplete="new-password"
                              disabled={registerLoading}
                            />
                            <button
                              type="button"
                              onClick={() =>
                                setShowRegPassword(!showRegPassword)
                              }
                              className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground disabled:cursor-not-allowed"
                              tabIndex={-1}
                              disabled={registerLoading}
                            >
                              {showRegPassword ? (
                                <IconEyeOff className="size-3.5" />
                              ) : (
                                <IconEye className="size-3.5" />
                              )}
                            </button>
                          </div>
                        </div>

                        <div className="flex flex-col gap-1.5">
                          <Label
                            htmlFor="reg-phone"
                            className="text-sm font-medium text-foreground"
                          >
                            手机号
                          </Label>
                          <Input
                            id="reg-phone"
                            className="h-10 rounded-md border-border/80 bg-background transition-shadow focus-visible:ring-2 focus-visible:ring-primary/20"
                            type="tel"
                            inputMode="numeric"
                            placeholder="11 位手机号"
                            value={regPhone}
                            onChange={(e) => setRegPhone(e.target.value)}
                            autoComplete="tel"
                            disabled={registerLoading}
                          />
                        </div>

                        <div className="flex flex-col gap-1.5">
                          <Label
                            htmlFor="reg-name"
                            className="text-sm font-medium text-foreground"
                          >
                            姓名
                          </Label>
                          <Input
                            id="reg-name"
                            className="h-10 rounded-md border-border/80 bg-background transition-shadow focus-visible:ring-2 focus-visible:ring-primary/20"
                            type="text"
                            placeholder="真实姓名"
                            value={regName}
                            onChange={(e) => setRegName(e.target.value)}
                            autoComplete="name"
                            disabled={registerLoading}
                          />
                        </div>

                        <div className="flex flex-col gap-1.5">
                          <Label className="text-sm font-medium text-foreground">
                            部门（必选）
                          </Label>
                          {deptLoading ? (
                            <p className="flex items-center gap-2 text-xs text-muted-foreground">
                              <IconLoader2 className="size-3.5 animate-spin" />
                              加载部门树…
                            </p>
                          ) : deptFetchError ? (
                            <p className="text-xs text-destructive">
                              {deptFetchError}
                            </p>
                          ) : (
                            <RegisterDeptTree
                              nodes={deptNodes}
                              selectedPaths={selectedDeptPaths}
                              onTogglePath={(path) =>
                                setSelectedDeptPaths((prev) =>
                                  togglePath(prev, path),
                                )
                              }
                              disabled={registerLoading}
                            />
                          )}
                        </div>

                        <Button
                          type="submit"
                          className="w-full font-medium shadow-sm"
                          size={isElectron ? "lg" : "default"}
                          disabled={
                            registerLoading ||
                            !regUsername.trim() ||
                            !regPassword ||
                            !regPhone.trim() ||
                            !regName.trim() ||
                            selectedDeptPaths.length === 0 ||
                            deptLoading ||
                            !!deptFetchError
                          }
                        >
                          {registerLoading && (
                            <IconLoader2 className="mr-2 size-4 animate-spin" />
                          )}
                          {registerLoading ? "提交中..." : "注册"}
                        </Button>
                        <div className="mt-4 flex flex-wrap items-center justify-center gap-x-1 gap-y-0.5 text-sm">
                          <span className="text-muted-foreground">已有账号？</span>
                          <button
                            type="button"
                            onClick={() => switchAuthView("login")}
                            className="font-medium text-primary underline decoration-primary/25 underline-offset-4 transition hover:decoration-primary"
                          >
                            登录
                          </button>
                        </div>
                      </form>
                      {registerError && (
                        <p
                          className="mt-3 rounded-md bg-destructive/10 px-2 py-1.5 text-xs text-destructive"
                          role="alert"
                        >
                          {registerError}
                        </p>
                      )}
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <div
                    className={cn(
                      "w-full text-center",
                      isElectron ? "mt-4 border-t border-border/40 pt-3" : "mt-8 pt-2",
                    )}
                  >
                    <p className="text-[11px] text-muted-foreground/60">
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
    </div>
  )
}
