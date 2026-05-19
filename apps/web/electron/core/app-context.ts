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
}

export interface CreateAppContextOptions {
  devServerUrl?: string
  onLoginSuccess: () => void | Promise<void>
  windowManager: WindowManager
}

export function createAppPaths(mainDirname: string): {
  appRoot: string
  rendererDist: string
  indexHtml: string
  preloadPath: string
} {
  const appRoot = path.join(mainDirname, "../..")
  const rendererDist = path.join(appRoot, "dist")
  const indexHtml = path.join(rendererDist, "index.html")
  const preloadPath = path.join(mainDirname, "../preload/index.mjs")
  return { appRoot, rendererDist, indexHtml, preloadPath }
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
  }
}

/** 供 main/index 初始化 process.env.APP_ROOT */
export function resolveAppRootFromMainEntry(mainDirname: string): string {
  return createAppPaths(mainDirname).appRoot
}
