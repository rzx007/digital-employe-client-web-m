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
