import { useState, useEffect, useRef, useLayoutEffect } from "react"
import { decryptPwd } from "@/lib/password-sm"
import { createFileRoute } from "@tanstack/react-router"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { cn } from "@workspace/ui/lib/utils"
import { IconEye, IconEyeOff, IconLoader2, IconX } from "@tabler/icons-react"
import { motion, AnimatePresence } from "motion/react"
import logoImage from "@/assets/logo.png"
import bgImage from "@/assets/Group.png"
import { registerApi } from "@/api/auth"
import { getDeptTree } from "@/api/dept"
import { togglePath, type DeptTreeNode } from "@/lib/dept-tree"
import { RegisterDeptTree } from "@/components/login/register-dept-tree"

export const Route = createFileRoute("/register")({
  component: RegisterPage,
})

function RegisterPage() {
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
  const [registerDone, setRegisterDone] = useState(false)
  const isElectron = !!window.electronApi
  const shellRef = useRef<HTMLDivElement>(null)
  const columnRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
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
  }, [])

  useLayoutEffect(() => {
    if (!isElectron || !window.electronApi?.resizeRegisterWindow) return
    const shell = shellRef.current
    if (!shell) return

    const W = 400
    const maxPx = Math.floor(window.screen.availHeight * 0.92)

    const measureHeight = (): number => {
      const column = columnRef.current
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
          const h = Math.min(Math.max(natural, 500), maxPx)
          void window.electronApi!.resizeRegisterWindow!({
            width: W,
            height: h,
          })
        })
      })
    }

    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(shell)
    const col = columnRef.current
    if (col) ro.observe(col)

    return () => ro.disconnect()
  }, [isElectron, registerLoading, deptLoading, registerDone])

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setRegisterError(null)
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
        setRegisterDone(true)
        if (isElectron) {
          window.electronApi?.notifyRegisterSuccess(regUsername.trim())
        } else {
          localStorage.setItem("register_success", regUsername.trim())
        }
      } else {
        setRegisterError(res.msg || "注册失败")
      }
    } catch (err) {
      setRegisterError(
        err instanceof Error ? err.message : "网络异常，请稍后重试",
      )
    } finally {
      setRegisterLoading(false)
    }
  }

  const handleClose = () => {
    if (isElectron) {
      window.electronApi?.closeRegister()
    } else {
      window.close()
    }
  }

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
        {isElectron && (
          <div
            className="pointer-events-auto absolute top-0 right-0 z-10 flex items-center"
            style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          >
            <button
              type="button"
              title="关闭"
              className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-destructive hover:text-destructive-foreground"
              onClick={handleClose}
            >
              <IconX className="size-5" />
            </button>
          </div>
        )}

        <div
          className={cn(
            "pointer-events-auto select-none",
            isElectron
              ? "flex items-center px-4 pt-4"
              : "mx-auto flex w-full max-w-md items-center justify-center gap-2 pb-6",
          )}
        >
          <img src={logoImage} alt="DigitalEmployee" className="h-7 w-9" />
          <h1
            className={cn(
              "text-gray-800 tracking-wider",
              isElectron
                ? "ml-2 text-base font-semibold"
                : "text-xl font-semibold",
            )}
          >
            数字员工
          </h1>
        </div>
      </div>
      <div
        ref={isElectron ? shellRef : undefined}
        className={cn(
          isElectron
            ? "flex w-full flex-col overflow-x-hidden px-6 pb-3 pt-12"
            : "flex min-h-0 flex-1 flex-col justify-center px-4 pb-6 pt-20 md:px-6",
        )}
      >
        <div
          ref={isElectron ? columnRef : undefined}
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
                : "flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto overscroll-contain p-5 md:p-7",
            )}
          >
            <AnimatePresence mode="wait" initial={false}>
              {registerDone ? (
                <motion.div
                  key="success"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25, ease: "easeOut" }}
                  className="flex flex-col items-center justify-center py-10"
                >
                  <div className="mb-4 flex size-14 items-center justify-center rounded-full bg-emerald-100">
                    <svg
                      className="size-7 text-emerald-600"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2.5}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  </div>
                  <h3 className="mb-1 text-lg font-semibold text-foreground">
                    注册成功
                  </h3>
                  <p className="mb-6 text-sm text-muted-foreground">
                    请返回登录窗口登录
                  </p>
                  <Button onClick={handleClose} className="w-32">
                    关闭窗口
                  </Button>
                </motion.div>
              ) : (
                <motion.div
                  key="form"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                  className="w-full"
                >
                  <div className="mb-5 space-y-1">
                    <h3 className="text-xl font-semibold tracking-tight text-foreground">
                      创建账号
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      填写以下信息完成注册
                    </p>
                  </div>

                  <form
                    onSubmit={handleRegisterSubmit}
                    className="flex flex-col gap-3.5"
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

                    <div className="flex flex-col gap-1.5">
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
                  </form>
                  {registerError && (
                    <p
                      className="mt-3 rounded-md bg-destructive/10 px-2 py-1.5 text-xs text-destructive"
                      role="alert"
                    >
                      {registerError}
                    </p>
                  )}
                  <div className="mt-6 w-full text-center">
                    <p className="text-[11px] text-muted-foreground/60">
                      上海博般技术数据有限公司
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  )
}
