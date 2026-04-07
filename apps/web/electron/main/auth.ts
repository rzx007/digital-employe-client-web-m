import Store from "electron-store"

/**
 * 认证持久化管理
 *
 * 负责：
 * - 使用 electron-store 将 token 和用户信息持久化到磁盘
 * - rememberMe=true 时写入磁盘（下次启动免登录）
 * - rememberMe=false 时仅存内存（关闭应用后需重新登录）
 * - 提供初始化、保存、清除、查询接口
 *
 * 存储位置：app.getPath('userData')/auth.json
 * 结构：{ token, user, rememberMe }
 */

// 持久化数据结构
interface AuthStoreData {
  token: string | null
  user: Record<string, unknown> | null
  rememberMe: boolean
}

// 内存缓存（rememberMe=false 时使用）
let memoryStore: AuthStoreData = {
  token: null,
  user: null,
  rememberMe: false,
}

let store: Store<AuthStoreData> | null = null

/**
 * 初始化认证存储
 *
 * 在 app.whenReady() 最早期调用，读取磁盘上的持久化数据。
 */
export function initAuthStore(): void {
  store = new Store<AuthStoreData>({
    name: "auth",
    defaults: {
      token: null,
      user: null,
      rememberMe: false,
    },
  })

  // 将磁盘数据加载到内存缓存
  memoryStore = {
    token: store.get("token"),
    user: store.get("user"),
    rememberMe: store.get("rememberMe"),
  }
}

/**
 * 保存认证信息
 *
 * @param token - JWT token
 * @param user - 用户信息对象
 * @param rememberMe - 是否记住登录（持久化到磁盘）
 */
export function saveAuth(
  token: string,
  user: Record<string, unknown>,
  rememberMe: boolean
): void {
  // 始终更新内存缓存
  memoryStore = { token, user, rememberMe }

  // rememberMe=true 时持久化到磁盘
  if (rememberMe && store) {
    store.set("token", token)
    store.set("user", user)
    store.set("rememberMe", true)
  } else if (store) {
    // rememberMe=false 时清除磁盘数据（防止残留旧 token）
    store.clear()
  }
}

/**
 * 清除认证信息
 *
 * 退出登录时调用，同时清除磁盘和内存中的数据。
 */
export function clearAuth(): void {
  memoryStore = { token: null, user: null, rememberMe: false }
  if (store) {
    store.clear()
  }
}

/**
 * 检查是否有持久化的 token
 *
 * 用于启动时判断是否需要显示登录窗口。
 * rememberMe=true 时检查磁盘数据，rememberMe=false 时检查内存数据。
 */
export function hasToken(): boolean {
  if (memoryStore.token) return true
  if (store?.get("token")) return true
  return false
}

/**
 * 获取已存储的认证信息
 *
 * 优先返回内存缓存，回退到磁盘数据。
 */
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
