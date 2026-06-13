import * as React from "react"
import { getUserAvatarSrc } from "@/lib/avatar"
import { getAvatarUrl } from "@/api/avatar"
import { useAuthStore } from "@/stores/auth-store"

interface UserAvatarProps {
  /** 用户 id；为空时直接用预设图兜底 */
  userId?: string | number | null
  alt?: string
  /** 作用在 <img> 上的类名（尺寸/形状由调用方决定） */
  className?: string
}

/**
 * 登录用户头像。优先取本地后端上传的头像（GET /avatars/{userId}），
 * 加载失败（含未设置头像 404）则回退到按 userId 选的预设图。
 *
 * 订阅 auth-store.avatarVersion：上传头像后 store bumpAvatarVersion()，
 * 所有挂载的 UserAvatar 带新版本号重取，实现全局同步。
 */
export function UserAvatar({ userId, alt, className }: UserAvatarProps) {
  const avatarVersion = useAuthStore((s) => s.avatarVersion)
  const fallback = getUserAvatarSrc(userId)
  const [failed, setFailed] = React.useState(false)

  // 头像版本变化时重置失败标记，给新头像一次重取机会
  React.useEffect(() => {
    setFailed(false)
  }, [avatarVersion, userId])

  const src =
    userId != null && userId !== "" && !failed
      ? getAvatarUrl(userId, avatarVersion)
      : fallback

  return (
    <img
      src={src}
      alt={alt || "用户"}
      className={className}
      onError={() => {
        if (!failed) setFailed(true)
      }}
    />
  )
}
