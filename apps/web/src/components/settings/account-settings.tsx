import * as React from "react"
import { IconLock, IconLogout, IconTrash } from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Label } from "@workspace/ui/components/label"
import { Separator } from "@workspace/ui/components/separator"
import { cn } from "@workspace/ui/lib/utils"
import { useAuthStore } from "@/stores/auth-store"
import { ChangePasswordDialog } from "./change-password-dialog"
import { USER_AVATARS } from "./constants"

export function AccountSettings() {
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)
  const restoreSession = useAuthStore((s) => s.restoreSession)
  const [pwdDialogOpen, setPwdDialogOpen] = React.useState(false)
  React.useEffect(() => {
    void (async () => {
      await restoreSession()
    })()
  }, [restoreSession])

  const avatarIndex = user?.id ? parseInt(user.id.toString()) % 10 : 0
  const department = user?.dpts?.[0]?.name

  return (
    <>
      <ChangePasswordDialog
        open={pwdDialogOpen}
        onOpenChange={setPwdDialogOpen}
      />
      <div className="flex flex-col gap-5">
        <Card>
          <CardContent className="pt-6">
            <div className="mb-6 flex items-center gap-4">
              <div className="size-16 overflow-hidden rounded-full">
                <img
                  src={USER_AVATARS[avatarIndex]}
                  alt={user?.name || "用户"}
                  className="size-full object-cover"
                />
              </div>
              <div>
                <h3 className="text-xl font-medium">
                  {user?.name || "未知用户"}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {department || "未知部门"}
                </p>
              </div>
            </div>

            <h3 className="mb-4 text-sm font-medium">账号信息</h3>

            <div className="space-y-4">
              <div className="flex items-center">
                <div className="w-20 shrink-0">
                  <Label>用户名</Label>
                </div>
                <p
                  className={cn(
                    "text-sm",
                    !user?.username && "text-muted-foreground"
                  )}
                >
                  {user?.username || "未知用户"}
                </p>
              </div>

              <div className="flex items-center">
                <div className="w-20 shrink-0">
                  <Label>手机号</Label>
                </div>
                <p
                  className={cn(
                    "text-sm",
                    !user?.phoneNumber && "text-muted-foreground"
                  )}
                >
                  {user?.phoneNumber || "尚未绑定"}
                </p>
              </div>

              <div className="flex items-center">
                <div className="w-20 shrink-0">
                  <Label>邮箱</Label>
                </div>
                <p
                  className={cn(
                    "text-sm",
                    !user?.email && "text-muted-foreground"
                  )}
                >
                  {user?.email || "尚未绑定"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>账号安全</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <p className="text-sm font-medium">密码修改</p>
                <p className="text-xs text-muted-foreground">
                  密码修改后，您需要重新登录。
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPwdDialogOpen(true)}
              >
                <IconLock className="mr-2 size-4" />
                修改密码
              </Button>
            </div>

            <Separator />

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <p className="text-sm font-medium">退出登录</p>
                <p className="text-xs text-muted-foreground">
                  退出当前登录账号。
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={logout}>
                <IconLogout className="mr-2 size-4" />
                退出登录
              </Button>
            </div>

            <Separator />

            <div className="flex cursor-not-allowed items-center justify-between opacity-55">
              <div className="space-y-0.5">
                <p className="text-sm font-medium">注销账号</p>
                <p className="text-xs text-red-500">
                  注销账号不可恢复，所有数据将被删除。
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled
                className="border-red-200 text-red-500 hover:bg-red-100 hover:text-red-600"
              >
                <IconTrash className="mr-2 size-4" />
                注销账号
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  )
}
