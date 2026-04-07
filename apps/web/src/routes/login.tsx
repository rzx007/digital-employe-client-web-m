import { useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
} from "@workspace/ui/components/card"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Checkbox } from "@workspace/ui/components/checkbox"
import { Separator } from "@workspace/ui/components/separator"
import { IconEye, IconEyeOff, IconLoader2 } from "@tabler/icons-react"
import logoImage from "@/assets/logo.svg"

export const Route = createFileRoute("/login")({
  component: LoginPage,
})

function LoginPage() {
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [rememberMe, setRememberMe] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    // TODO: 对接登录 API
    setTimeout(() => {
      window?.electronApi?.loginSuccess()
      setLoading(false)
    }, 1500)
  }

  return (
    <div
      className="flex h-screen w-screen items-center justify-center bg-background"
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      <div className="flex w-full max-w-sm flex-col items-center gap-6 px-6">
        {/* Logo + 标题 */}
        <div className="flex flex-col items-center gap-2">
          <img src={logoImage} alt="DigitalEmployee" className="h-12 w-12" />
          <h1 className="font-heading text-lg font-semibold text-foreground">
            DigitalEmployee
          </h1>
          <p className="text-xs text-muted-foreground">
            数字员工智能助手
          </p>
        </div>

        {/* 登录表单卡片 */}
        <Card className="w-full" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
          <CardContent className="flex flex-col gap-4 pt-0">
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              {/* 账号 */}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="username">账号</Label>
                <Input
                  id="username"
                  type="text"
                  placeholder="请输入账号"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  disabled={loading}
                />
              </div>

              {/* 密码 */}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="password">密码</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="请输入密码"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pr-8"
                    autoComplete="current-password"
                    disabled={loading}
                  />
                  {/* 密码显示/隐藏切换按钮 */}
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground disabled:cursor-not-allowed"
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

              {/* 记住我 + 忘记密码 */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Checkbox
                    id="remember"
                    checked={rememberMe}
                    onCheckedChange={(checked) =>
                      setRememberMe(checked === true)
                    }
                    disabled={loading}
                  />
                  <Label htmlFor="remember" className="cursor-pointer">
                    记住我
                  </Label>
                </div>
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  忘记密码?
                </button>
              </div>

              {/* 登录按钮 */}
              <Button
                type="submit"
                className="w-full"
                size="lg"
                disabled={loading}
              >
                {loading && <IconLoader2 className="animate-spin" />}
                {loading ? "登录中..." : "登 录"}
              </Button>
            </form>

            <Separator />

            {/* 注册入口 */}
            <Button
              variant="outline"
              className="w-full"
              size="lg"
              disabled={loading}
            >
              注 册
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
