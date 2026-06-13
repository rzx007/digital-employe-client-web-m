import { request, getServerBaseUrl } from "@/lib/request"

/** 允许的头像类型与体积上限（与后端一致） */
export const AVATAR_ACCEPT = "image/png,image/jpeg,image/webp"
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024

/**
 * 上传用户头像。
 * POST /avatars/{userId} (multipart, 字段名 file)
 * 返回 { avatar_url }
 */
export async function uploadAvatar(
  userId: string | number,
  file: File,
): Promise<{ avatar_url: string }> {
  const form = new FormData()
  form.append("file", file)
  const res = await request<{ code: number; data: { avatar_url: string } }>(
    `/avatars/${userId}`,
    {
      method: "POST",
      body: form,
    },
  )
  return res.data
}

/**
 * 头像回显 URL（指向本地后端 GET /avatars/{userId}）。
 * 后端无头像时该请求返回 404，调用方 <img onError> 回退到预设图。
 * cacheBust：上传后传入新时间戳，强制浏览器重取。
 */
export function getAvatarUrl(
  userId: string | number,
  cacheBust?: number,
): string {
  // dev：base 为相对路径 "/actus"（经 vite 代理到后端）；打包：base 为 http://host:port
  const base = getServerBaseUrl().replace(/\/$/, "")
  const url = `${base}/avatars/${userId}`
  return cacheBust ? `${url}?cb=${cacheBust}` : url
}
