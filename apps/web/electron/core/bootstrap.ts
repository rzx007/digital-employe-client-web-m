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
import {
  resolveActivationGate,
  createActivationWindow,
} from "../features/activation"
import { initAutoUpdater } from "../features/update/auto-updater"
import { createMacApplicationMenu } from "../main/application-menu"
import { registerPetdexOnProtocol } from "./petdex-protocol"
import { registerPreviewCorsGuard } from "../features/preview-cors/preview-cors-guard"
import { createAppContext } from "./app-context"
import { IpcRegistry } from "./ipc/registry"
import { WindowManager } from "./services/window-manager"
import { allIpcContributions } from "../features"
import { initExtensions } from "../features/extension/extension-loader"
import { rootLogger } from "./logger"
import { isOfflineMode } from "./runtime-env"

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
  registerPreviewCorsGuard()

  const ctx = createAppContext(options.mainDirname, {
    devServerUrl: options.devServerUrl,
    windowManager: options.windowManager,
    onLoginSuccess: options.createMainWindow,
    createMainWindow: options.createMainWindow,
  })

  const registry = new IpcRegistry(ctx)
  for (const contribution of allIpcContributions) {
    registry.register(contribution)
  }

  initExtensions()

  initAutoUpdater()

  createSplashWindow()

  try {
    await startBackend()
    rootLogger.info("backend server ready")

    const gate = await resolveActivationGate()
    closeSplashWindow()

    if (gate === "activation") {
      rootLogger.info("activation required, opening activation window")
      createActivationWindow()
    } else if (isOfflineMode() || hasToken()) {
      rootLogger.info("offline mode or saved token found, skipping login")
      await options.createMainWindow()
    } else {
      rootLogger.info("no saved token, opening login window")
      createLoginWindow()
    }
  } catch (err) {
    rootLogger.error("backend failed", {
      message: err instanceof Error ? err.message : String(err),
    })
    const message = err instanceof Error ? err.message : String(err)
    notifySplashBackendError(message)
    setTimeout(async () => {
      closeSplashWindow()
      try {
        const gate = await resolveActivationGate()
        if (gate === "activation") {
          createActivationWindow()
          return
        }
      } catch {
        /* backend 未就绪时跳过激活门控 */
      }
      if (isOfflineMode() || hasToken()) {
        void options.createMainWindow()
      } else {
        createLoginWindow()
      }
    }, 1500)
  }
}
