import * as React from "react"
import { IconLoader2, IconEye, IconEyeOff } from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { cn } from "@workspace/ui/lib/utils"
import { updatePassword } from "@/api/auth"
import { decryptPwd } from "@/lib/password-sm"
import { useAuthStore } from "@/stores/auth-store"
import { toast } from "sonner"

interface ChangePasswordFormProps {
  onSuccess: () => void
  onCancel: () => void
  isElectron?: boolean
}

export function ChangePasswordForm({
  onSuccess,
  onCancel,
  isElectron = false,
}: ChangePasswordFormProps) {
  const { pendingPasswordChange, login, clearPendingPasswordChange } =
    useAuthStore()

  const [oldPwd, setOldPwd] = React.useState("")
  const [newPwd, setNewPwd] = React.useState("")
  const [confirmPwd, setConfirmPwd] = React.useState("")
  const [showOld, setShowOld] = React.useState(false)
  const [showNew, setShowNew] = React.useState(false)
  const [showConfirm, setShowConfirm] = React.useState(false)
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [submitting, setSubmitting] = React.useState(false)

  const validate = (): boolean => {
    const errs: Record<string, string> = {}
    if (!oldPwd) {
      errs.oldPwd = "旧密码不可为空"
    }
    if (!newPwd) {
      errs.newPwd = "新密码不可为空"
    } else if (newPwd.length < 8 || newPwd.length > 15) {
      errs.newPwd = "密码长度需在8-15位之间"
    } else {
      const hasUpper = /[A-Z]/.test(newPwd)
      const hasLower = /[a-z]/.test(newPwd)
      const hasNumber = /[0-9]/.test(newPwd)
      const hasSpecial = /[^A-Za-z0-9]/.test(newPwd)
      const typeCount = [hasUpper, hasLower, hasNumber, hasSpecial].filter(
        Boolean
      ).length
      if (typeCount < 3)
        errs.newPwd = "密码需包含大写字母、小写字母、数字、特殊字符中至少三种"
      if (
        pendingPasswordChange?.username &&
        newPwd.includes(pendingPasswordChange.username)
      ) {
        errs.newPwd = "密码不能包含用户名"
      }
    }
    if (!confirmPwd) {
      errs.confirmPwd = "确认密码不可为空"
    } else if (newPwd !== confirmPwd) {
      errs.confirmPwd = "两次输入的密码不一致"
    }
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!validate() || !pendingPasswordChange) return

    setSubmitting(true)
    try {
      const res = await updatePassword({
        id: pendingPasswordChange.userId,
        oldPassword: decryptPwd(oldPwd),
        password: decryptPwd(newPwd),
      })
      if (res.code === 1) {
        toast.success("密码修改成功，正在自动登录...")
        await login(pendingPasswordChange.username, decryptPwd(newPwd), false)
        clearPendingPasswordChange()
        onSuccess()
      } else {
        toast.error(res.msg || "密码修改失败")
      }
    } catch {
      toast.error("密码修改失败")
    } finally {
      setSubmitting(false)
    }
  }

  const handleCancel = () => {
    clearPendingPasswordChange()
    onCancel()
  }

  return (
    <div
      style={
        isElectron
          ? ({ WebkitAppRegion: "no-drag" } as React.CSSProperties)
          : undefined
      }
    >
      <h3
        className={cn(
          "font-bold",
          isElectron ? "mb-4 text-lg" : "mb-8 text-2xl"
        )}
      >
        修改密码
      </h3>
      <p className="mb-4 text-sm text-muted-foreground">
        您的密码已过期，请修改密码后继续
      </p>

      <form
        onSubmit={handleSubmit}
        className={cn("flex flex-col", isElectron ? "gap-4" : "gap-5")}
      >
        {/* 旧密码 */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="oldPwd" className="text-sm font-bold">
            旧密码
          </Label>
          <div className="relative">
            <Input
              id="oldPwd"
              type={showOld ? "text" : "password"}
              placeholder="请输入旧密码"
              value={oldPwd}
              onChange={(e) => setOldPwd(e.target.value)}
              className="rounded-xs pr-8"
              disabled={submitting}
              autoFocus
            />
            <button
              type="button"
              onClick={() => setShowOld(!showOld)}
              className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              tabIndex={-1}
            >
              {showOld ? (
                <IconEyeOff className="size-3.5" />
              ) : (
                <IconEye className="size-3.5" />
              )}
            </button>
          </div>
          {errors.oldPwd && (
            <p className="text-xs text-destructive">{errors.oldPwd}</p>
          )}
        </div>

        {/* 新密码 */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="newPwd" className="text-sm font-bold">
            新密码
          </Label>
          <div className="relative">
            <Input
              id="newPwd"
              type={showNew ? "text" : "password"}
              placeholder="8-15位，包含至少三种字符类型"
              value={newPwd}
              onChange={(e) => setNewPwd(e.target.value)}
              className="rounded-xs pr-8"
              disabled={submitting}
            />
            <button
              type="button"
              onClick={() => setShowNew(!showNew)}
              className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              tabIndex={-1}
            >
              {showNew ? (
                <IconEyeOff className="size-3.5" />
              ) : (
                <IconEye className="size-3.5" />
              )}
            </button>
          </div>
          {errors.newPwd && (
            <p className="text-xs text-destructive">{errors.newPwd}</p>
          )}
        </div>

        {/* 确认新密码 */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="confirmPwd" className="text-sm font-bold">
            确认新密码
          </Label>
          <div className="relative">
            <Input
              id="confirmPwd"
              type={showConfirm ? "text" : "password"}
              placeholder="请再次输入新密码"
              value={confirmPwd}
              onChange={(e) => setConfirmPwd(e.target.value)}
              className="rounded-xs pr-8"
              disabled={submitting}
            />
            <button
              type="button"
              onClick={() => setShowConfirm(!showConfirm)}
              className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              tabIndex={-1}
            >
              {showConfirm ? (
                <IconEyeOff className="size-3.5" />
              ) : (
                <IconEye className="size-3.5" />
              )}
            </button>
          </div>
          {errors.confirmPwd && (
            <p className="text-xs text-destructive">{errors.confirmPwd}</p>
          )}
        </div>

        {/* 按钮 */}
        <div className="flex gap-2 pt-2">
          <Button
            type="submit"
            className="flex-1"
            size={isElectron ? "lg" : "default"}
            disabled={submitting || !oldPwd || !newPwd || !confirmPwd}
          >
            {submitting && <IconLoader2 className="mr-2 size-4 animate-spin" />}
            {submitting ? "提交中..." : "确认修改"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size={isElectron ? "lg" : "default"}
            onClick={handleCancel}
            disabled={submitting}
          >
            取消
          </Button>
        </div>
      </form>
    </div>
  )
}
