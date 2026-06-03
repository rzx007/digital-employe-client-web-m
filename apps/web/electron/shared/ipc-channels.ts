/**
 * IPC channel 常量 — 主进程 handler 与 preload bridge 共用
 */
export const IpcChannels = {
  getBackendStatus: "get-backend-status",
  getBackendPort: "get-backend-port",
  quitApp: "quit-app",
  minimizeWindow: "minimize-window",
  closeWindow: "close-window",
  maximizeWindow: "maximize-window",
  isMaximized: "is-maximized",
  setForceQuit: "set-force-quit",
  getPlatform: "get-platform",
  flashTray: "flash-tray",
  stopFlashTray: "stop-flash-tray",
  sendNotification: "send-notification",
  loginSuccess: "login-success",
  saveAuth: "save-auth",
  clearAuth: "clear-auth",
  getAuthStatus: "get-auth-status",
  hasSavedAuth: "has-saved-auth",
  openRecruitment: "open-recruitment",
  closeRecruitment: "close-recruitment",
  hireSuccess: "hire-success",
  openRegister: "open-register",
  closeRegister: "close-register",
  registerSuccess: "register-success",
  resizeRegisterWindow: "resize-register-window",
  openSettings: "open-settings",
  closeSettings: "close-settings",
  setAutoLaunch: "set-auto-launch",
  getAutoLaunch: "get-auto-launch",
  setNotifications: "set-notifications",
  getNotifications: "get-notifications",
  setAutoUpdate: "set-auto-update",
  getAutoUpdate: "get-auto-update",
  getPetSettings: "get-pet-settings",
  setPetSettings: "set-pet-settings",
  petGetSelected: "pet:get-selected",
  petSelect: "pet:select",
  petListPetdex: "pet:list-petdex",
  petGetPetdexMeta: "pet:get-petdex-meta",
  petInstallFromZip: "pet:install-from-zip",
  petUninstall: "pet:uninstall",
  petShow: "pet:show",
  petHide: "pet:hide",
  petSetPosition: "pet:set-position",
  petGetPosition: "pet:get-position",
  getOnboardingCompleted: "get-onboarding-completed",
  setOnboardingCompleted: "set-onboarding-completed",
  getModelSettings: "get-model-settings",
  setModelSettings: "set-model-settings",
  getEndpoint: "get-endpoint",
  setEndpoint: "set-endpoint",
  resetApp: "reset-app",
  checkUpdate: "check-update",
  startDownload: "start-download",
  quitAndInstall: "quit-and-install",
  openLogsDirectory: "open-logs-directory",
  exportLogs: "export-logs",
  activationSuccess: "activation-success",
  // browser panel
  browserOpen: "browser:open",
  browserNavigate: "browser:navigate",
  browserResize: "browser:resize",
  browserHide: "browser:hide",
  browserShow: "browser:show",
  browserClose: "browser:close",
  browserConfirmResolve: "browser:confirm-resolve",
  browserSyncBounds: "browser:sync-bounds",
} as const

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels]

// ── 强类型映射 ──

export interface BackendStatus {
  ready: boolean
  port: number
  running: boolean
  /** 桌面包是否为离线版（py-server/.offline 或 OFFLINE_MODE） */
  offlinePackage: boolean
}

export interface PlatformInfo {
  isLinux: boolean
  isWin: boolean
  isMac: boolean
}

export interface AuthStatus {
  token: string | null
  user: Record<string, unknown> | null
  rememberMe: boolean
}

export interface PetSettings {
  petEnabled: boolean
  petVisibilityMode: "always" | "when_main_hidden"
  petAlwaysOnTop: boolean
}

export interface PetPosition {
  x: number
  y: number
}

export interface CustomPetSkin {
  slug: string
  displayName: string
  description: string
  source: "installed" | "petdex"
  petId?: string
}

/** @deprecated use CustomPetSkin */
export type PetdexSkin = CustomPetSkin

export interface CustomPetMeta {
  id?: string
  displayName?: string
  description?: string
  spritesheetPath?: string
  folderSlug: string
  source: "installed" | "petdex"
}

/** @deprecated use CustomPetMeta */
export type PetdexMeta = CustomPetMeta

export interface ModelSettings {
  model: string
  apiKey: string
  apiUrl: string
}

export interface DownloadProgress {
  percent: number
  bytesPerSecond: number
  transferred: number
  total: number
}

export interface UpdateAvailableInfo {
  update: boolean
  version: string
  newVersion: string
}

/**
 * 每个 IPC invoke channel 的 args 和 return 类型
 * 主进程 handler 与 preload bridge 共用此类型推导
 */
export interface IpcInvokeMap {
  // backend
  [IpcChannels.getBackendStatus]: { args: []; result: BackendStatus }
  [IpcChannels.getBackendPort]: { args: []; result: number }
  // window
  [IpcChannels.quitApp]: { args: []; result: void }
  [IpcChannels.minimizeWindow]: { args: []; result: void }
  [IpcChannels.closeWindow]: { args: []; result: void }
  [IpcChannels.maximizeWindow]: { args: []; result: void }
  [IpcChannels.isMaximized]: { args: []; result: boolean }
  [IpcChannels.setForceQuit]: { args: [value: boolean]; result: void }
  [IpcChannels.getPlatform]: { args: []; result: PlatformInfo }
  // notification-tray
  [IpcChannels.flashTray]: { args: []; result: void }
  [IpcChannels.stopFlashTray]: { args: []; result: void }
  [IpcChannels.sendNotification]: {
    args: [options: { title: string; body: string; silent?: boolean }]
    result: void
  }
  // auth
  [IpcChannels.loginSuccess]: { args: []; result: void }
  [IpcChannels.saveAuth]: {
    args: [
      data: {
        token: string
        user: Record<string, unknown>
        rememberMe: boolean
      },
    ]
    result: void
  }
  [IpcChannels.clearAuth]: { args: []; result: void }
  [IpcChannels.getAuthStatus]: { args: []; result: AuthStatus }
  [IpcChannels.hasSavedAuth]: { args: []; result: boolean }
  // recruitment
  [IpcChannels.openRecruitment]: { args: []; result: void }
  [IpcChannels.closeRecruitment]: { args: []; result: void }
  [IpcChannels.hireSuccess]: { args: []; result: void }
  [IpcChannels.openRegister]: { args: []; result: void }
  [IpcChannels.closeRegister]: { args: []; result: void }
  [IpcChannels.registerSuccess]: { args: [username: string]; result: void }
  [IpcChannels.resizeRegisterWindow]: {
    args: [size: { width: number; height: number }]
    result: void
  }
  // settings
  [IpcChannels.openSettings]: { args: []; result: void }
  [IpcChannels.closeSettings]: { args: []; result: void }
  [IpcChannels.setAutoLaunch]: { args: [enabled: boolean]; result: void }
  [IpcChannels.getAutoLaunch]: { args: []; result: boolean }
  [IpcChannels.setNotifications]: { args: [enabled: boolean]; result: void }
  [IpcChannels.getNotifications]: { args: []; result: boolean }
  [IpcChannels.setAutoUpdate]: { args: [enabled: boolean]; result: void }
  [IpcChannels.getAutoUpdate]: { args: []; result: boolean }
  [IpcChannels.getPetSettings]: { args: []; result: PetSettings }
  [IpcChannels.setPetSettings]: {
    args: [
      partial: Partial<{
        petEnabled: boolean
        petVisibilityMode: "always" | "when_main_hidden"
        petAlwaysOnTop: boolean
      }>,
    ]
    result: void
  }
  [IpcChannels.petGetSelected]: { args: []; result: string }
  [IpcChannels.petSelect]: { args: [slug: string]; result: void }
  [IpcChannels.petListPetdex]: { args: []; result: CustomPetSkin[] }
  [IpcChannels.petGetPetdexMeta]: {
    args: [slug: string]
    result: CustomPetMeta | null
  }
  [IpcChannels.petInstallFromZip]: {
    args: []
    result: { slug: string; displayName: string } | null
  }
  [IpcChannels.petUninstall]: { args: [slug: string]; result: void }
  [IpcChannels.getOnboardingCompleted]: { args: []; result: boolean }
  [IpcChannels.setOnboardingCompleted]: {
    args: [value: boolean]
    result: void
  }
  [IpcChannels.getModelSettings]: { args: []; result: ModelSettings }
  [IpcChannels.setModelSettings]: {
    args: [data: { model: string; apiKey: string; apiUrl: string }]
    result: void
  }
  [IpcChannels.getEndpoint]: { args: []; result: string }
  [IpcChannels.setEndpoint]: { args: [endpoint: string]; result: void }
  [IpcChannels.resetApp]: { args: []; result: void }
  [IpcChannels.openLogsDirectory]: { args: []; result: void }
  [IpcChannels.exportLogs]: { args: []; result: { path: string } | null }
  // activation
  [IpcChannels.activationSuccess]: { args: []; result: void }
  // update
  [IpcChannels.checkUpdate]: { args: []; result: unknown }
  [IpcChannels.startDownload]: { args: []; result: void }
  [IpcChannels.quitAndInstall]: { args: []; result: void }
  // pet window
  [IpcChannels.petShow]: { args: []; result: void }
  [IpcChannels.petHide]: { args: []; result: void }
  [IpcChannels.petSetPosition]: { args: [x: number, y: number]; result: void }
  [IpcChannels.petGetPosition]: { args: []; result: PetPosition | null }
  // browser panel
  [IpcChannels.browserOpen]: { args: [url: string]; result: void }
  [IpcChannels.browserNavigate]: { args: [url: string]; result: void }
  [IpcChannels.browserResize]: { args: [widthRatio: number]; result: void }
  [IpcChannels.browserHide]: { args: []; result: void }
  [IpcChannels.browserShow]: { args: []; result: void }
  [IpcChannels.browserClose]: { args: []; result: void }
  [IpcChannels.browserConfirmResolve]: {
    args: [id: string, approved: boolean]
    result: boolean
  }
  [IpcChannels.browserSyncBounds]: {
    args: [
      bounds: { x: number; y: number; width: number; height: number },
    ]
    result: void
  }
}

/** 类型安全的 invoke 辅助：从 IpcInvokeMap 推导 return type */
export type IpcResult<C extends IpcChannel> = IpcInvokeMap[C]["result"]
