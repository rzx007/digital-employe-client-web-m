import { create } from "zustand"
import { loginApi } from "@/api/auth"
import type { LoginUser } from "@/api/types"

interface AuthState {
  token: string | null
  user: LoginUser | null
  isAuthenticated: boolean
  loading: boolean
  error: string | null

  login: (
    username: string,
    password: string,
    rememberMe: boolean
  ) => Promise<void>
  logout: () => Promise<void>
  restoreSession: () => Promise<void>
  clearError: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  user: null,
  isAuthenticated: false,
  loading: false,
  error: null,

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

      if (res.code === 200 && res.data.code === 1 && res.data.token && res.data.result?.length > 0) {
        const token = res.data.token
        const user = res.data.result[0]

        // 写入 localStorage（request.ts 的 getAuthToken() 从这里读取）
        localStorage.setItem("token", token)

        // 通过 IPC 持久化到 electron-store（仅 Electron 环境）
        await window.electronApi?.saveAuth(
          token,
          user as unknown as Record<string, unknown>,
          rememberMe
        )

        set({ token, user, isAuthenticated: true, loading: false })

        // 通知主进程：关闭登录窗口，打开主窗口
        await window.electronApi?.loginSuccess()
      } else {
        set({
          loading: false,
          error: res.data.msg || "登录失败",
        })
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "网络错误，请重试"
      set({ loading: false, error: message })
    }
  },

  logout: async () => {
    localStorage.removeItem("token")

    // 清除 electron-store 中的持久化数据
    // Electron 环境下：主进程会关闭主窗口、打开登录窗口
    // 非 Electron 环境下：手动跳转登录页
    const isElectron = window.electronApi?.isElectron
    await window.electronApi?.clearAuth()

    set({ token: null, user: null, isAuthenticated: false })

    if (!isElectron) {
      window.location.hash = "#/login"
    }
  },

  restoreSession: async () => {
    // 从 electron-store 恢复认证信息到 localStorage
    const status = await window.electronApi?.getAuthStatus()
    if (status?.token) {
      localStorage.setItem("token", status.token)
      set({
        token: status.token,
        user: status.user as unknown as LoginUser,
        isAuthenticated: true,
      })
    }
  },

  clearError: () => set({ error: null }),
}))
