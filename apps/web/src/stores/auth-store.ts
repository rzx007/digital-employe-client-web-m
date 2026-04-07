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

      if (res.code === 1 && res.token && res.result?.length > 0) {
        const token = res.token
        const user = res.result[0]

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
          error: res.msg || "登录失败",
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
    await window.electronApi?.clearAuth()

    set({ token: null, user: null, isAuthenticated: false })

    // 跳转到登录页
    window.location.hash = "#/login"
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
