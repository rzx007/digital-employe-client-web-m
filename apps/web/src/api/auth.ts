import { request } from "@/lib/request"
import type { LoginResponse } from "./types"

/**
 * 登录接口
 *
 * POST /api/login
 * body: { username, password }
 * 返回: { code: 1, result: [user], token, msg }
 */
export function loginApi(username: string, password: string) {
  return request<LoginResponse>("/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  })
}
/**
 * 更新用户密码接口
 *
 * POST /api/update-password
 * body: { id, oldPassword, password }
 * 返回: { code: 1, msg: string }
 */
export function updatePassword(data: {
  id: number
  oldPassword: string
  password: string
}) {
  return request<{ code: number; msg: string }>("/update-password", {
    method: "POST",
    body: {
      id: data.id,
      oldpassword: data.oldPassword,
      password: data.password,
    },
  })
}

export function getOAuthAuthorizeUrl(provider: string) {
  return request<{ url: string }>(`/oauth/${provider}/authorize`)
}
