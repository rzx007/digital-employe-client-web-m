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
import logoImage from "@/assets/logo1.png"
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

/* 方案A · 浅色精致版 —— 品牌靛蓝取自全局 --primary token */
const PRIMARY = "oklch(0.488 0.243 264.376)"
const HERO_BG =
  "linear-gradient(135deg, oklch(0.488 0.243 264.376) 0%, oklch(0.52 0.225 264) 55%, oklch(0.57 0.2 264) 100%)"
const BTN_BG =
  "linear-gradient(135deg, oklch(0.488 0.243 264.376), oklch(0.55 0.215 264))"

/* 输入框聚焦 / 占位符 + 主按钮微交互。作用域以 .lgn- 前缀隔离,不污染全局。 */
const SCOPED_CSS = `
.lgn-field::placeholder{color:#A8AEC2}
.lgn-field:focus{border-color:${PRIMARY};background:#fff;box-shadow:0 0 0 3px oklch(0.488 0.243 264.376 / 0.14)}
.lgn-field:disabled{opacity:.6;cursor:not-allowed}
.lgn-primary{transition:transform .12s ease,box-shadow .12s ease,opacity .12s ease}
.lgn-primary:hover:not(:disabled){transform:translateY(-1px)}
.lgn-primary:active:not(:disabled){transform:translateY(0)}
.lgn-primary:disabled{opacity:.55;cursor:not-allowed;box-shadow:none}
.lgn-icon-btn{transition:background .15s ease,border-color .15s ease}
@media (prefers-reduced-motion: reduce){
  .lgn-primary{transition:none}
  .lgn-primary:hover:not(:disabled){transform:none}
}
`

const HERO_COPY: Record<LoginView, { title: string; subtitle: string }> = {
  login: { title: "欢迎回来", subtitle: "登录以继续使用数字员工" },
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

  const hero = HERO_COPY[currentView]

  return (
    <div
      className={
        inElectron
          ? "relative flex h-screen w-screen flex-col overflow-hidden"
          : "relative flex min-h-screen w-screen items-center justify-center overflow-hidden px-4 py-10"
      }
      style={{
        background: inElectron
          ? "#FFFFFF"
          : "radial-gradient(120% 80% at 50% -10%, #E9EEFC 0%, rgba(233,238,252,0) 60%), linear-gradient(180deg, #F4F6FD 0%, #FBFCFE 100%)",
        ...dragStyle(inElectron),
      }}
    >
      <style>{SCOPED_CSS}</style>

      <div
        className="flex w-full flex-col overflow-hidden"
        style={{
          background: "#FFFFFF",
          fontFamily:
            "'Raleway Variable', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif",
          ...(inElectron
            ? { height: "100%", borderRadius: 0, boxShadow: "none" }
            : {
              maxWidth: 360,
              borderRadius: 18,
              boxShadow: "0 24px 60px -20px rgba(40,52,120,0.28)",
            }),
          ...noDrag,
        }}
      >
        {/* ── Hero ── */}
        <div
          className="relative shrink-0 overflow-hidden"
          style={{
            padding: "18px 24px 22px",
            background: HERO_BG,
            ...dragStyle(inElectron),
          }}
        >
          {/* 品牌微光装饰(替换方案A的条纹占位,贴合"克制专业") */}
          <div
            aria-hidden
            className="pointer-events-none absolute"
            style={{
              right: -34,
              top: -30,
              width: 168,
              height: 168,
              borderRadius: 28,
              transform: "rotate(8deg)",
              background:
                "radial-gradient(120% 120% at 30% 20%, rgba(255,255,255,0.22), rgba(255,255,255,0) 62%)",
              border: "1px solid rgba(255,255,255,0.12)",
            }}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute"
            style={{
              right: 18,
              top: 22,
              opacity: 0.5,
              transform: "rotate(8deg)",
            }}
          >
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none">
              <path
                d="M2 14c3.5-6 6.5-6 10 0s6.5 6 10 0"
                stroke="rgba(255,255,255,0.55)"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
              <path
                d="M2 9c3.5-6 6.5-6 10 0s6.5 6 10 0"
                stroke="rgba(255,255,255,0.28)"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </div>

          {/* 顶栏:logo + 标题 + 窗口控制 */}
          <div className="relative flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div
                className="flex items-center justify-center"

              >
                <img
                  src={logoImage}
                  alt="数字员工"
                  style={{ width: 20, height: 20, objectFit: "contain" }}
                />
              </div>
              <span
                style={{
                  color: "#fff",
                  fontWeight: 600,
                  fontSize: 16,
                  letterSpacing: "0.02em",
                }}
              >
                数字员工
              </span>
            </div>

            {inElectron && (
              <div className="flex items-center gap-1.5" style={noDrag}>
                <button
                  type="button"
                  title="通信设置"
                  onClick={() =>
                    setCurrentView(
                      currentView === "endpoint" ? "login" : "endpoint"
                    )
                  }
                  className="lgn-icon-btn flex items-center justify-center"
                  style={{
                    width: 28,
                    height: 28,
                    border: "none",
                    borderRadius: 8,
                    background: "rgba(255,255,255,0.16)",
                    color: "#fff",
                    cursor: "pointer",
                  }}
                  onMouseEnter={(e) =>
                  (e.currentTarget.style.background =
                    "rgba(255,255,255,0.28)")
                  }
                  onMouseLeave={(e) =>
                  (e.currentTarget.style.background =
                    "rgba(255,255,255,0.16)")
                  }
                >
                  <IconSettings size={15} />
                </button>
                <button
                  type="button"
                  title="关闭"
                  onClick={() => void withElectronApi((api) => api.quitApp())}
                  className="lgn-icon-btn flex items-center justify-center"
                  style={{
                    width: 28,
                    height: 28,
                    border: "none",
                    borderRadius: 8,
                    background: "rgba(255,255,255,0.16)",
                    color: "#fff",
                    cursor: "pointer",
                  }}
                  onMouseEnter={(e) =>
                  (e.currentTarget.style.background =
                    "rgba(255,255,255,0.28)")
                  }
                  onMouseLeave={(e) =>
                  (e.currentTarget.style.background =
                    "rgba(255,255,255,0.16)")
                  }
                >
                  <IconX size={15} />
                </button>
              </div>
            )}
          </div>

          {/* 标题区(随视图变化) */}
          <div className="relative" style={{ marginTop: 22 }}>
            <div
              style={{
                color: "#fff",
                fontSize: 24,
                fontWeight: 700,
                letterSpacing: "0.01em",
              }}
            >
              {hero.title}
            </div>
            <div
              style={{
                color: "rgba(255,255,255,0.82)",
                fontSize: 12.5,
                marginTop: 4,
              }}
            >
              {hero.subtitle}
            </div>
          </div>
        </div>

        {/* ── Body ── */}
        <div
          style={{
            padding: 24,
            ...(inElectron ? { flex: 1, overflowY: "auto" } : {}),
            ...noDrag,
          }}
        >
          {currentView === "endpoint" ? (
            <EndpointConfig
              key="endpoint"
              isElectron={inElectron}
              onCancel={() => setCurrentView("login")}
              onSaved={handleEndpointSaved}
            />
          ) : (
            <AnimatePresence mode="wait" initial={false}>
              {currentView === "changePassword" ? (
                <motion.div
                  key="changePassword"
                  initial={{ x: 240, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  exit={{ x: -240, opacity: 0 }}
                  transition={{ duration: 0.25, ease: "easeOut" }}
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
                  initial={{ x: 240, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  exit={{ x: -240, opacity: 0 }}
                  transition={{ duration: 0.25, ease: "easeOut" }}
                >
                  {registerSuccessHint && (
                    <div
                      className="mb-4 flex items-center gap-2"
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
                        style={{
                          width: 6,
                          height: 6,
                          background: "#10b981",
                        }}
                      />
                      注册成功，请登录
                    </div>
                  )}

                  <form onSubmit={handleSubmit}>
                    <label
                      htmlFor="username"
                      style={{
                        display: "block",
                        fontSize: 13,
                        fontWeight: 600,
                        color: "#5A6072",
                        marginBottom: 8,
                      }}
                    >
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
                      style={{
                        width: "100%",
                        height: 46,
                        border: "1px solid #E4E7F0",
                        background: "#F7F8FC",
                        borderRadius: 11,
                        padding: "0 14px",
                        fontSize: 14,
                        color: "#2A2E3C",
                        outline: "none",
                        transition: "all .15s",
                      }}
                    />

                    <label
                      htmlFor="password"
                      style={{
                        display: "block",
                        fontSize: 13,
                        fontWeight: 600,
                        color: "#5A6072",
                        margin: "18px 0 8px",
                      }}
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
                        style={{
                          width: "100%",
                          height: 46,
                          border: "1px solid #E4E7F0",
                          background: "#F7F8FC",
                          borderRadius: 11,
                          padding: "0 44px 0 14px",
                          fontSize: 14,
                          color: "#2A2E3C",
                          outline: "none",
                          transition: "all .15s",
                        }}
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
                      style={{ marginTop: 16 }}
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
                            width: 17,
                            height: 17,
                            borderRadius: 5,
                            border: `1.5px solid ${rememberMe ? PRIMARY : "#CFD3E0"}`,
                            background: rememberMe ? PRIMARY : "#fff",
                            transition: "all .12s",
                          }}
                        >
                          {rememberMe && (
                            <svg
                              width="11"
                              height="11"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="#fff"
                              strokeWidth="3.2"
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
                        height: 48,
                        marginTop: 22,
                        border: "none",
                        borderRadius: 12,
                        background: BTN_BG,
                        color: "#fff",
                        fontSize: 15,
                        fontWeight: 600,
                        cursor: "pointer",
                        boxShadow:
                          "0 12px 24px -8px oklch(0.488 0.243 264.376 / 0.55)",
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

                  {/* 分割线 */}
                  <div
                    className="flex items-center"
                    style={{ gap: 12, margin: "24px 0 16px" }}
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
                      className="lgn-icon-btn flex items-center justify-center"
                      style={{
                        width: 42,
                        height: 42,
                        borderRadius: "50%",
                        border: "1px solid #E4E7F0",
                        background: "#F7F8FC",
                        cursor: loading ? "not-allowed" : "pointer",
                        opacity: loading ? 0.5 : 1,
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = "#fff"
                        e.currentTarget.style.borderColor = PRIMARY
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = "#F7F8FC"
                        e.currentTarget.style.borderColor = "#E4E7F0"
                      }}
                    >
                      <img src={feishuIcon} alt="飞书" width={20} height={20} />
                    </button>
                  </div>

                  <div
                    style={{
                      textAlign: "center",
                      fontSize: 11.5,
                      color: "#B4B9C7",
                      marginTop: 20,
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
