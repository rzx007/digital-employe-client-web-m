import { Menu, protocol } from "electron"
import { initAuthStore, hasToken } from "../features/auth/auth-store"
import { initSettingsStore } from "../features/settings/settings-store"
import { startBackend } from "../features/backend/backend-process"
import {
  createSplashWindow,
  closeSplashWindow,
  notifySplashBackendError,
} from "../features/splash/window-splash"
import { createLoginWindow } from "../features/auth/window-login"
import { initAutoUpdater } from "../features/update/auto-updater"
import { createMacApplicationMenu } from "../main/application-menu"
import { registerPetdexOnProtocol } from "./petdex-protocol"
import { createAppContext } from "./app-context"
import { IpcRegistry } from "./ipc/registry"
import { WindowManager } from "./services/window-manager"
import { allIpcContributions } from "../features"

export interface BootstrapOptions {
  mainDirname: string
  devServerUrl?: string
  windowManager: WindowManager
  createMainWindow: () => void | Promise<void>
}

/**
 * 应用就绪后的启动编排
 */
export async function bootstrapApp(options: BootstrapOptions): Promise<void> {
  if (process.platform === "darwin") {
    Menu.setApplicationMenu(createMacApplicationMenu())
  } else {
    Menu.setApplicationMenu(null)
  }

  initAuthStore()
  initSettingsStore()

  registerPetdexOnProtocol(protocol)

  const ctx = createAppContext(options.mainDirname, {
    devServerUrl: options.devServerUrl,
    windowManager: options.windowManager,
    onLoginSuccess: options.createMainWindow,
  })

  const registry = new IpcRegistry(ctx)
  for (const contribution of allIpcContributions) {
    registry.register(contribution)
  }

  initAutoUpdater()

  createSplashWindow()

  try {
    await startBackend()
    console.log("[App] backend server ready")
    closeSplashWindow()

    if (hasToken()) {
      console.log("[App] saved token found, skipping login...")
      await options.createMainWindow()
    } else {
      console.log("[App] no saved token, opening login window...")
      createLoginWindow()
    }
  } catch (err) {
    console.error("[App] backend failed:", err)
    const message = err instanceof Error ? err.message : String(err)
    notifySplashBackendError(message)
    setTimeout(() => {
      closeSplashWindow()
      createLoginWindow()
    }, 1500)
  }
}
