import * as React from "react"
import {
  IconLock,
  IconLogout,
  IconTrash,
  IconCamera,
  IconLoader2,
} from "@tabler/icons-react"
import { toast } from "sonner"
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
import {
  uploadAvatar,
  getAvatarUrl,
  AVATAR_ACCEPT,
  AVATAR_MAX_BYTES,
} from "@/api/avatar"
import { ChangePasswordDialog } from "./change-password-dialog"
import { USER_AVATARS } from "./constants"

export function AccountSettings() {
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)
  const restoreSession = useAuthStore((s) => s.restoreSession)
  const [pwdDialogOpen, setPwdDialogOpen] = React.useState(false)
  const [uploading, setUploading] = React.useState(false)
  // cache-bust：上传成功后递增，强制 <img> 重新拉取后端头像
  const [avatarVersion, setAvatarVersion] = React.useState(0)
  // 后端头像加载失败（含未设置头像 404）时回退预设图
  const [avatarFailed, setAvatarFailed] = React.useState(false)
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    void (async () => {
      await restoreSession()
    })()
  }, [restoreSession])

  const avatarIndex = user?.id ? parseInt(user.id.toString()) % 10 : 0
  const department = user?.dpts?.[0]?.name

  const fallbackAvatar = USER_AVATARS[avatarIndex]
  const avatarSrc =
    user?.id != null && !avatarFailed
      ? getAvatarUrl(user.id, avatarVersion)
      : fallbackAvatar

  const handlePickAvatar = () => {
    if (uploading) return
    fileInputRef.current?.click()
  }

  const handleAvatarChange = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0]
    e.target.value = "" // 允许重选同名文件
    if (!file || user?.id == null) return

    if (!AVATAR_ACCEPT.split(",").includes(file.type)) {
      toast.error("仅支持 PNG / JPG / WEBP 图片")
      return
    }
    if (file.size > AVATAR_MAX_BYTES) {
      toast.error("图片不能超过 5MB")
      return
    }

    setUploading(true)
    try {
      await uploadAvatar(user.id, file)
      setAvatarFailed(false)
      setAvatarVersion((v) => v + 1)
      toast.success("头像已更新")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "头像上传失败")
    } finally {
      setUploading(false)
    }
  }

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
              <button
                type="button"
                onClick={handlePickAvatar}
                disabled={uploading}
                title="点击更换头像"
                className="group relative size-16 shrink-0 overflow-hidden rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <img
                  src={avatarSrc}
                  alt={user?.name || "用户"}
                  className="size-full object-cover"
                  onError={() => {
                    if (!avatarFailed) setAvatarFailed(true)
                  }}
                />
                <span className="absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 transition-opacity group-hover:opacity-100">
                  {uploading ? (
                    <IconLoader2 className="size-5 animate-spin text-white" />
                  ) : (
                    <IconCamera className="size-5 text-white" />
                  )}
                </span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept={AVATAR_ACCEPT}
                className="hidden"
                onChange={handleAvatarChange}
              />
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
