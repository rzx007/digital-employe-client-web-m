import path from "node:path"
import type { WindowManager } from "./services/window-manager"

export interface AppContext {
  readonly devServerUrl?: string
  readonly indexHtml: string
  readonly preloadPath: string
  readonly appRoot: string
  readonly rendererDist: string
  readonly windowManager: WindowManager
  onLoginSuccess: () => void | Promise<void>
  /** 创建（或重建）主窗。主窗已被关闭/销毁时用于重新拉起。 */
  createMainWindow: () => void | Promise<void>
}

export interface CreateAppContextOptions {
  devServerUrl?: string
  onLoginSuccess: () => void | Promise<void>
  createMainWindow: () => void | Promise<void>
  windowManager: WindowManager
}

export function createAppPaths(mainDirname: string): {
  appRoot: string
  rendererDist: string
  indexHtml: string
  preloadPath: string
  extensionPreloadPath: string
} {
  const appRoot = path.join(mainDirname, "../..")
  const rendererDist = path.join(appRoot, "dist")
  const indexHtml = path.join(rendererDist, "index.html")
  const preloadPath = path.join(mainDirname, "../preload/index.mjs")
  const extensionPreloadPath = path.join(
    mainDirname,
    "../preload/extension-preload.mjs",
  )
  return { appRoot, rendererDist, indexHtml, preloadPath, extensionPreloadPath }
}

export function createAppContext(
  mainDirname: string,
  options: CreateAppContextOptions,
): AppContext {
  const paths = createAppPaths(mainDirname)
  return {
    devServerUrl: options.devServerUrl,
    indexHtml: paths.indexHtml,
    preloadPath: paths.preloadPath,
    appRoot: paths.appRoot,
    rendererDist: paths.rendererDist,
    windowManager: options.windowManager,
    onLoginSuccess: options.onLoginSuccess,
    createMainWindow: options.createMainWindow,
  }
}

/** 供 main/index 初始化 process.env.APP_ROOT */
export function resolveAppRootFromMainEntry(mainDirname: string): string {
  return createAppPaths(mainDirname).appRoot
}
