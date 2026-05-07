import { request } from "@/lib/request"
import type { LoginResponse, RegisterResponse } from "./types"

/**
 * 登录接口
 *
 * POST /api/login
 * body: { username, password }
 * 返回: { code: 1, result: [user], token, msg }
 */
export function loginApi(username: string, password: string) {
  return request<LoginResponse>("/yc/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  })
}

/**
 * 用户注册
 *
 * POST /yc/register
 * body: { username, password, phoneNumber, name } — password 与登录一致（SM2 加密串）
 */
export function registerApi(body: {
  username: string
  password: string
  phoneNumber: string
  name: string
  /** 从根到所选节点的 id 路径，可多选，如 [[1, 8, 15]] */
  departmentIds: number[][]
}) {
  return request<RegisterResponse>("/yc/register", {
    method: "POST",
    body: {
      username: body.username,
      password: body.password,
      phoneNumber: body.phoneNumber,
      name: body.name,
      departmentIds: body.departmentIds,
    },
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
