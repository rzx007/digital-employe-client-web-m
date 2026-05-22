import Store from "electron-store"
import { getStoreDir } from "../settings/settings-store"

interface AuthStoreData {
  token: string | null
  user: Record<string, unknown> | null
  rememberMe: boolean
}

let memoryStore: AuthStoreData = {
  token: null,
  user: null,
  rememberMe: false,
}

let store: Store<AuthStoreData> | null = null

export function initAuthStore(): void {
  store = new Store<AuthStoreData>({
    name: "auth",
    cwd: getStoreDir(),
    defaults: {
      token: null,
      user: null,
      rememberMe: false,
    },
  })

  memoryStore = {
    token: store.get("token"),
    user: store.get("user"),
    rememberMe: store.get("rememberMe"),
  }
}

export function saveAuth(
  token: string,
  user: Record<string, unknown>,
  rememberMe: boolean,
): void {
  memoryStore = { token, user, rememberMe }

  if (rememberMe && store) {
    store.set("token", token)
    store.set("user", user)
    store.set("rememberMe", true)
  } else if (store) {
    store.clear()
  }
}

export function clearAuth(): void {
  memoryStore = { token: null, user: null, rememberMe: false }
  if (store) {
    store.clear()
  }
}

export function hasToken(): boolean {
  if (memoryStore.token) return true
  if (store?.get("token")) return true
  return false
}

export function getStoredAuth(): AuthStoreData {
  if (memoryStore.token) return memoryStore
  if (store) {
    return {
      token: store.get("token"),
      user: store.get("user"),
      rememberMe: store.get("rememberMe"),
    }
  }
  return { token: null, user: null, rememberMe: false }
}
