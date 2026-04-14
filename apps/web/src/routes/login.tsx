import { useState } from "react"
import { decryptPwd } from "@/lib/password-sm"
import { createFileRoute } from "@tanstack/react-router"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Checkbox } from "@workspace/ui/components/checkbox"
import {
  IconEye,
  IconEyeOff,
  IconLoader2,
  IconSettings,
  IconX,
} from "@tabler/icons-react"
import logoImage from "@/assets/logo.svg"
import bgImage from "@/assets/Group.png"
import { useAuthStore } from "@/stores/auth-store"
import { EndpointConfig } from "@/components/login/endpoint-config"
import { useEndpointStore } from "@/stores/endpoint-store"
import { updateRequestBaseUrl } from "@/lib/request"

export const Route = createFileRoute("/login")({
  component: LoginPage,
})

type LoginView = "login" | "endpoint"

function LoginPage() {
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [rememberMe, setRememberMe] = useState(false)
  const [currentView, setCurrentView] = useState<LoginView>("login")
  const { login, loading, error, clearError } = useAuthStore()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    clearError()
    await login(username, decryptPwd(password), rememberMe)
  }

  const isElectron = !!window.electronApi

  const handleEndpointSaved = () => {
    const baseUrl = useEndpointStore.getState().getBaseUrl()
    updateRequestBaseUrl(baseUrl)
    setCurrentView("login")
  }

  return (
    <div
      className="relative h-screen w-screen overflow-hidden"
      style={
        {
          background: `url(${bgImage}) no-repeat 100% 0%, linear-gradient(180deg, #eaf0fd 1%, rgba(236, 242, 255, 0.74) 27%, rgba(255, 255, 255, 0) 83%)`,
          WebkitAppRegion: "drag",
        } as React.CSSProperties
      }
    >
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

      {/* 左上角 Logo + 名称 */}
      <div className="flex items-center px-4 pt-4 select-none">
        <img src={logoImage} alt="DigitalEmployee" className="h-7 w-7" />
        <h1 className="ml-2 text-base font-semibold tracking-wider text-gray-800">
          数字员工
        </h1>
      </div>

      {currentView === "endpoint" ? (
        <EndpointConfig
          onCancel={() => setCurrentView("login")}
          onSaved={handleEndpointSaved}
        />
      ) : (
        <div className="flex flex-col items-center justify-center px-6 pt-10">
          <h3 className="mb-6 text-xl font-bold">欢迎回来</h3>

          <div
            className="w-full max-w-sm"
            style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          >
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="username" className="text-sm font-bold">
                  账号
                </Label>
                <Input
                  id="username"
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
                    className="pr-8"
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
                size="lg"
                disabled={loading || !username || !password}
              >
                {loading && (
                  <IconLoader2 className="mr-2 size-4 animate-spin" />
                )}
                登录
              </Button>

              {/* {error && <p className="text-xs text-destructive">{error}</p>} */}
            </form>

            <p className="mt-4 w-full text-center text-xs text-muted-foreground">
              还没有账号?{" "}
              <span className="cursor-pointer text-primary">联系管理员</span>
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
