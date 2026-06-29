import { useState, useEffect, useRef } from "react"
import { decryptPwd } from "@/lib/password-sm"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
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

/* 强调色全部走全局 --primary token,跟随主题变更 */
const PRIMARY = "var(--primary)"

/* 表单/按钮样式集中在 .lgn- 类里,endpoint-config 等子表单复用同一套 */
const SCOPED_CSS = `
.lgn-field{width:100%;height:40px;border:1px solid #E4E7F0;background:#fff;border-radius:9px;padding:0 13px;font-size:13.5px;color:#2A2E3C;outline:none;transition:border-color .15s ease,box-shadow .15s ease}
.lgn-field::placeholder{color:#A8AEC2}
.lgn-field:focus{border-color:var(--primary);box-shadow:0 0 0 3px color-mix(in srgb, var(--primary) 16%, transparent)}
.lgn-field:disabled{opacity:.6;cursor:not-allowed}
.lgn-label{display:block;font-size:13px;font-weight:600;color:#5A6072;margin-bottom:8px}
.lgn-primary{transition:background .15s ease,transform .1s ease,opacity .12s ease}
.lgn-primary:hover:not(:disabled){background:color-mix(in srgb, var(--primary) 88%, #000)}
.lgn-primary:active:not(:disabled){transform:translateY(0.5px)}
.lgn-primary:disabled{opacity:.5;cursor:not-allowed}
.lgn-tile{transition:border-color .15s ease,background .15s ease}
.lgn-tile:hover:not(:disabled){border-color:var(--primary);background:#F7F8FC}
.lgn-ghost{transition:background .15s ease,color .15s ease}
.lgn-ghost:hover{background:#F1F2F7;color:#5A6072}
@media (prefers-reduced-motion: reduce){
  .lgn-primary{transition:background .15s ease}
  .lgn-primary:active:not(:disabled){transform:none}
}
`

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
      className={
        inElectron
          ? "relative flex h-screen w-screen items-stretch justify-center overflow-hidden"
          : "relative flex min-h-screen w-screen items-center justify-center overflow-hidden px-4 py-10"
      }
      style={{
        background: inElectron
          ? "#FFFFFF"
          : "radial-gradient(120% 80% at 50% -10%, #EEF1FB 0%, rgba(238,241,251,0) 60%), #F6F7FB",
        ...dragStyle(inElectron),
      }}
    >
      <style>{SCOPED_CSS}</style>

      <div
        className="flex w-full flex-col"
        style={{
          background: "#FFFFFF",
          fontFamily:
            "'Raleway Variable', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif",
          ...(inElectron
            ? { height: "100%" }
            : {
                maxWidth: 360,
                borderRadius: 16,
                border: "0.5px solid #E9ECF3",
                boxShadow: "0 20px 50px -24px rgba(40,52,120,0.22)",
              }),
          ...noDrag,
        }}
      >
        {/* 顶栏:窗口控制(Electron 专属),同时作为拖拽手柄 */}
        <div
          className="flex shrink-0 items-center justify-between"
          style={{ height: 44, padding: "0 12px", ...dragStyle(inElectron) }}
        >
          {inElectron ? (
            <button
              type="button"
              title="通信设置"
              onClick={() =>
                setCurrentView(
                  currentView === "endpoint" ? "login" : "endpoint"
                )
              }
              className="lgn-ghost flex items-center justify-center"
              style={{
                width: 30,
                height: 30,
                border: "none",
                borderRadius: 8,
                background: "transparent",
                color: "#9298AB",
                cursor: "pointer",
                ...noDrag,
              }}
            >
              <IconSettings size={18} />
            </button>
          ) : (
            <span />
          )}

          {inElectron && (
            <button
              type="button"
              title="关闭"
              onClick={() => void withElectronApi((api) => api.quitApp())}
              className="lgn-ghost flex items-center justify-center"
              style={{
                width: 30,
                height: 30,
                border: "none",
                borderRadius: 8,
                background: "transparent",
                color: "#9298AB",
                cursor: "pointer",
                ...noDrag,
              }}
            >
              <IconX size={18} />
            </button>
          )}
        </div>

        {/* 主体 */}
        <div
          className="flex flex-1 flex-col"
          style={{ padding: "4px 28px 24px", overflowY: "auto", ...noDrag }}
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
                    className="flex flex-col items-center"
                    style={{
                      paddingTop: 14,
                      paddingBottom: 24,
                      ...dragStyle(inElectron),
                    }}
                  >
                    <img
                      src={logoImage}
                      alt="数字员工"
                      style={{
                        height: 58,
                        width: "auto",
                        objectFit: "contain",
                      }}
                    />
                    <div
                      style={{
                        marginTop: 16,
                        fontSize: 24,
                        fontWeight: 700,
                        letterSpacing: "0.06em",
                        color: "#1E2233",
                      }}
                    >
                      数字员工
                    </div>
                    <div
                      style={{
                        marginTop: 6,
                        fontSize: 11.5,
                        letterSpacing: "0.34em",
                        textTransform: "uppercase",
                        color: "#B4B9C7",
                      }}
                    >
                      boban staff
                    </div>
                  </div>

                  {registerSuccessHint && (
                    <div
                      className="mb-3 flex items-center gap-2"
                      style={{
                        borderRadius: 10,
                        border: "1px solid rgba(16,185,129,0.28)",
                        background: "rgba(16,185,129,0.08)",
                        padding: "8px 12px",
                        fontSize: 12,
                        color: "#047857",
                      }}
                    >
                      <span
                        className="inline-block shrink-0 rounded-full"
                        style={{ width: 6, height: 6, background: "#10b981" }}
                      />
                      注册成功，请登录
                    </div>
                  )}

                  <form onSubmit={handleSubmit}>
                    <label htmlFor="username" className="lgn-label">
                      账号
                    </label>
                    <input
                      id="username"
                      className="lgn-field"
                      type="text"
                      placeholder="请输入你的用户名"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      autoComplete="username"
                      disabled={loading}
                      autoFocus
                    />

                    <label
                      htmlFor="password"
                      className="lgn-label"
                      style={{ marginTop: 16 }}
                    >
                      密码
                    </label>
                    <div style={{ position: "relative" }}>
                      <input
                        id="password"
                        className="lgn-field"
                        type={showPassword ? "text" : "password"}
                        placeholder="初始密码 Aa123456"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        autoComplete="current-password"
                        disabled={loading}
                        style={{ paddingRight: 42 }}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        tabIndex={-1}
                        disabled={loading}
                        title={showPassword ? "隐藏密码" : "显示密码"}
                        className="flex items-center justify-center"
                        style={{
                          position: "absolute",
                          right: 6,
                          top: "50%",
                          transform: "translateY(-50%)",
                          width: 34,
                          height: 34,
                          border: "none",
                          background: "transparent",
                          color: "#8A8F9E",
                          cursor: "pointer",
                        }}
                      >
                        {showPassword ? (
                          <IconEyeOff size={18} />
                        ) : (
                          <IconEye size={18} />
                        )}
                      </button>
                    </div>

                    <div
                      className="flex items-center justify-between"
                      style={{ marginTop: 14 }}
                    >
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={rememberMe}
                        onClick={() => setRememberMe(!rememberMe)}
                        disabled={loading}
                        className="flex items-center gap-2 select-none"
                        style={{
                          border: "none",
                          background: "transparent",
                          padding: 0,
                          cursor: "pointer",
                        }}
                      >
                        <span
                          className="flex items-center justify-center"
                          style={{
                            width: 16,
                            height: 16,
                            borderRadius: 5,
                            border: `1.5px solid ${rememberMe ? PRIMARY : "#CFD3E0"}`,
                            background: rememberMe ? PRIMARY : "#fff",
                            transition: "all .12s",
                          }}
                        >
                          {rememberMe && (
                            <svg
                              width="10"
                              height="10"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="#fff"
                              strokeWidth="3.4"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <path d="M4 12.5l5 5L20 6" />
                            </svg>
                          )}
                        </span>
                        <span style={{ fontSize: 13, color: "#5A6072" }}>
                          记住密码
                        </span>
                      </button>

                      <div style={{ fontSize: 13, color: "#9298AB" }}>
                        还没有账号？
                        <button
                          type="button"
                          onClick={handleOpenRegister}
                          style={{
                            border: "none",
                            background: "transparent",
                            padding: 0,
                            marginLeft: 2,
                            color: PRIMARY,
                            fontWeight: 600,
                            cursor: "pointer",
                          }}
                        >
                          去注册
                        </button>
                      </div>
                    </div>

                    <button
                      type="submit"
                      className="lgn-primary flex items-center justify-center gap-2"
                      disabled={loading || !username || !password}
                      style={{
                        width: "100%",
                        height: 42,
                        marginTop: 18,
                        border: "none",
                        borderRadius: 9,
                        background: PRIMARY,
                        color: "var(--primary-foreground)",
                        fontSize: 14.5,
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      {loading && (
                        <IconLoader2 size={16} className="animate-spin" />
                      )}
                      {loading ? "登录中..." : "登录"}
                    </button>
                  </form>

                  {error && (
                    <p
                      style={{
                        marginTop: 10,
                        fontSize: 12.5,
                        color: "oklch(0.577 0.245 27.325)",
                      }}
                    >
                      {error}
                    </p>
                  )}

                  {/* 其他登录方式 */}
                  <div
                    className="flex items-center"
                    style={{ gap: 12, margin: "22px 0 14px" }}
                  >
                    <div
                      style={{ flex: 1, height: 1, background: "#ECEEF5" }}
                    />
                    <span style={{ fontSize: 12, color: "#A8AEC2" }}>
                      其他登录方式
                    </span>
                    <div
                      style={{ flex: 1, height: 1, background: "#ECEEF5" }}
                    />
                  </div>

                  <div className="flex justify-center">
                    <button
                      type="button"
                      onClick={handleFeishuLogin}
                      disabled={loading}
                      title="飞书登录"
                      className="lgn-tile flex items-center justify-center"
                      style={{
                        width: 38,
                        height: 38,
                        borderRadius: "50%",
                        border: "1px solid #E4E7F0",
                        background: "#fff",
                        cursor: loading ? "not-allowed" : "pointer",
                        opacity: loading ? 0.5 : 1,
                      }}
                    >
                      <img src={feishuIcon} alt="飞书" width={19} height={19} />
                    </button>
                  </div>

                  <div
                    style={{
                      textAlign: "center",
                      fontSize: 11.5,
                      color: "#B4B9C7",
                      marginTop: "auto",
                      paddingTop: 24,
                    }}
                  >
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
      <div
        className="flex items-center gap-2"
        style={{ paddingTop: 6, paddingBottom: 18 }}
      >
        <img
          src={logoImage}
          alt="数字员工"
          style={{ height: 22, width: "auto", objectFit: "contain" }}
        />
        <span
          style={{
            fontSize: 15,
            fontWeight: 700,
            letterSpacing: "0.04em",
            color: "#1E2233",
          }}
        >
          数字员工
        </span>
      </div>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: "#1E2233" }}>
          {copy.title}
        </div>
        <div style={{ fontSize: 12.5, color: "#9298AB", marginTop: 4 }}>
          {copy.subtitle}
        </div>
      </div>
      {children}
    </div>
  )
}
