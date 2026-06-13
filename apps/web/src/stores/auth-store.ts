import { create } from "zustand"
import { loginApi } from "@/api/auth"
import { setConfigKv } from "@/api/config-kv"
import type { LoginUser } from "@/api/types"
import { getMyWorkspace } from "@/api/workspace"
import {
  isElectron,
  requireElectronApi,
  withElectronApi,
} from "@/lib/electron/host"
import { track } from "@/lib/telemetry"

interface PendingPasswordChange {
  token: string
  userId: number
  username: string
}

interface AuthState {
  token: string | null
  user: LoginUser | null
  workspaceId: number | null
  isAuthenticated: boolean
  loading: boolean
  error: string | null
  pendingPasswordChange: PendingPasswordChange | null

  login: (
    username: string,
    password: string,
    rememberMe: boolean
  ) => Promise<void>
  /** 用已签发的本系统 token + 用户信息建立登录态（飞书等第三方登录复用此出口） */
  loginWithToken: (
    token: string,
    user: LoginUser,
    rememberMe?: boolean
  ) => Promise<void>
  logout: () => Promise<void>
  restoreSession: () => Promise<void>
  clearError: () => void
  clearPendingPasswordChange: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  user: null,
  workspaceId: null,
  isAuthenticated: false,
  loading: false,
  error: null,
  pendingPasswordChange: null,

  login: async (username, password, rememberMe) => {
    set({ loading: true, error: null })

    try {
      const res = await loginApi(username, password)
      // const res = {
      //   "code": 1,
      //   "result": [
      //     {
      //       "id": 1,
      //       "name": "系统管理员",
      //       "username": "bbadmin",
      //       "menuid": "1",
      //       "orgType": null,
      //       "orgNo": null,
      //       "email": "ca@greg.co",
      //       "phoneNumber": "13720349091",
      //       "expirationTime": null,
      //       "status": "1",
      //       "loginTime": "2026-04-07 06:32:11",
      //       "changePwdTime": "2026-04-07 06:21:05",
      //       "inTime": null,
      //       "inIp": null,
      //       "consInfo": {},
      //       "dpts": [
      //         {
      //           "id": 10,
      //           "name": "爱可生",
      //           "parentId": null,
      //           "description": null,
      //           "createTime": null,
      //           "updateTime": null,
      //           "status": "1"
      //         }
      //       ]
      //     }
      //   ],
      //   "noMenus": false,
      //   "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ0aWQiOjEsIm1lbnVpZCI6IjEiLCJ1c2VybmFtZSI6ImJiYWRtaW4iLCJvcmdObyI6bnVsbCwib3JnVHlwZSI6bnVsbCwiZHB0SWRzIjoiMTAiLCJsb2dpbklwIjoiMTAuMTcyLjI0Ni4xNDQiLCJjaGFuZ2VQd2RUaW1lIjoiMjAyNi0wNC0wNyAwNjoyMTowNSIsImV4cFRpbWUiOjE3OTYyODE1NDk1NTksImlhdCI6MTc3NTU0NTU0OSwiZXhwIjoxNzc2NDA5NTQ5fQ.ViBSPVwb7tRfFRWQ1uj-BtfY_t_EwNIgNWsooWvaVTQ",
      //   "msg": ""
      // }
      if (res.code === -2) {
        set({
          loading: false,
          pendingPasswordChange: {
            token: res.token,
            userId: res.result?.id,
            username,
          },
        })
        return
      }

      if (res.code === 1 && res.token && res.result?.length > 0) {
        await useAuthStore
          .getState()
          .loginWithToken(res.token, res.result[0], rememberMe)
      } else {
        set({
          loading: false,
          error: res.msg || "登录失败",
        })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "网络错误，请重试"
      set({ loading: false, error: message })
    }
  },

  loginWithToken: async (token, user, rememberMe = false) => {
    localStorage.setItem("token", token)
    // 显示名（真实姓名）只在客户端有，token 里没有；写入供埋点上报
    localStorage.setItem("displayName", user.name ?? "")

    if (isElectron()) {
      await requireElectronApi((api) =>
        api.saveAuth(
          token,
          user as unknown as Record<string, unknown>,
          rememberMe
        )
      )
    }

    set({ token, user, isAuthenticated: true, loading: false })

    // 活跃度埋点：用户登录（DAU/WAU/MAU 主依据）
    track("login")

    try {
      await setConfigKv("USERNAME", user.name)
    } catch (error) {
      console.warn("Failed to persist USERNAME config kv:", error)
    }

    try {
      const workspace = await getMyWorkspace(String(user.id), user.name)
      localStorage.setItem("workspaceId", String(workspace.id))
      set({ workspaceId: workspace.id })
    } catch (error) {
      console.warn("Failed to get workspace:", error)
    }

    if (isElectron()) {
      await requireElectronApi((api) => api.loginSuccess())
    }
  },

  logout: async () => {
    localStorage.removeItem("token")
    localStorage.removeItem("workspaceId")
    localStorage.removeItem("displayName")

    const inElectron = isElectron()
    if (inElectron) {
      await withElectronApi((api) => api.clearAuth(), { silent: true })
    }

    set({ token: null, user: null, workspaceId: null })

    if (!inElectron) {
      window.location.hash = "#/login"
    }
  },

  restoreSession: async () => {
    if (!isElectron()) return
    const status = await requireElectronApi((api) => api.getAuthStatus())
    if (status?.token) {
      localStorage.setItem("token", status.token)
      const user = status.user as unknown as LoginUser
      localStorage.setItem("displayName", user?.name ?? "")
      set({
        token: status.token,
        user,
        isAuthenticated: true,
      })

      const cachedWsId = localStorage.getItem("workspaceId")
      if (cachedWsId) {
        set({ workspaceId: Number(cachedWsId) })
      }

      try {
        const workspace = await getMyWorkspace(
          String(user?.id ?? ""),
          user?.name ?? ""
        )
        localStorage.setItem("workspaceId", String(workspace.id))
        set({ workspaceId: workspace.id })
      } catch (error) {
        console.warn("Failed to restore workspace:", error)
      }
    }
  },

  clearError: () => set({ error: null }),
  clearPendingPasswordChange: () => set({ pendingPasswordChange: null }),
}))
