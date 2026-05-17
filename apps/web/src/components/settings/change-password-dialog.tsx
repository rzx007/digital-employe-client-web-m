import * as React from "react"
import { toast } from "sonner"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { updatePassword } from "@/api/auth"
import { decryptPwd } from "@/lib/password-sm"
import { useAuthStore } from "@/stores/auth-store"

export function ChangePasswordDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)
  const [oldPwd, setOldPwd] = React.useState("")
  const [newPwd, setNewPwd] = React.useState("")
  const [confirmPwd, setConfirmPwd] = React.useState("")
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [submitting, setSubmitting] = React.useState(false)

  const validate = (): boolean => {
    const errs: Record<string, string> = {}
    if (!oldPwd) errs.oldPwd = "旧密码不可为空"
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
        Boolean,
      ).length
      if (typeCount < 3)
        errs.newPwd = "密码需包含大写字母、小写字母、数字、特殊字符中至少三种"
      if (user?.username && newPwd.includes(user.username))
        errs.newPwd = "密码不能包含用户名"
    }
    if (!confirmPwd) {
      errs.confirmPwd = "确认密码不可为空"
    } else if (newPwd !== confirmPwd) {
      errs.confirmPwd = "两次输入的密码不一致"
    }
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  const handleSubmit = async () => {
    if (!validate() || !user?.id) return
    setSubmitting(true)
    try {
      const res = await updatePassword({
        id: user.id,
        oldPassword: decryptPwd(oldPwd),
        password: decryptPwd(newPwd),
      })
      if (res.data?.code === 1) {
        toast.success("密码修改成功，请重新登录")
        onOpenChange(false)
        setOldPwd("")
        setNewPwd("")
        setConfirmPwd("")
        logout()
      } else {
        toast.error(res.data?.msg || "密码修改失败")
      }
    } catch {
      toast.error("密码修改失败")
    } finally {
      setSubmitting(false)
    }
  }

  const handleClose = (v: boolean) => {
    if (!v) {
      setOldPwd("")
      setNewPwd("")
      setConfirmPwd("")
      setErrors({})
    }
    onOpenChange(v)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>修改密码</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="old-pwd">旧密码</Label>
            <Input
              id="old-pwd"
              type="password"
              placeholder="请输入旧密码"
              value={oldPwd}
              onChange={(e) => setOldPwd(e.target.value)}
            />
            {errors.oldPwd && (
              <p className="text-xs text-destructive">{errors.oldPwd}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-pwd">新密码</Label>
            <Input
              id="new-pwd"
              type="password"
              placeholder="8-15位，包含至少三种字符类型"
              value={newPwd}
              onChange={(e) => setNewPwd(e.target.value)}
            />
            {errors.newPwd && (
              <p className="text-xs text-destructive">{errors.newPwd}</p>
            )}
            <p className="text-xs text-muted-foreground">
              密码需包含大写字母、小写字母、数字、特殊字符中至少三种
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm-pwd">确认新密码</Label>
            <Input
              id="confirm-pwd"
              type="password"
              placeholder="请再次输入新密码"
              value={confirmPwd}
              onChange={(e) => setConfirmPwd(e.target.value)}
            />
            {errors.confirmPwd && (
              <p className="text-xs text-destructive">{errors.confirmPwd}</p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? "保存中..." : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
