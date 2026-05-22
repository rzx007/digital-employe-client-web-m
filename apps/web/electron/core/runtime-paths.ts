import { createAppPaths } from "./app-context"

export interface ElectronRuntimePaths {
  readonly appRoot: string
  readonly rendererDist: string
  readonly indexHtml: string
  readonly preloadPath: string
  readonly extensionPreloadPath: string
  readonly devServerUrl?: string
}

let runtime: ElectronRuntimePaths | null = null

export function bindElectronRuntime(
  mainDirname: string,
  devServerUrl?: string,
): ElectronRuntimePaths {
  const paths = createAppPaths(mainDirname)
  runtime = { ...paths, devServerUrl }
  return runtime
}

export function getElectronRuntime(): ElectronRuntimePaths {
  if (!runtime) {
    throw new Error(
      "[ElectronRuntime] not initialized — call bindElectronRuntime() in main/index",
    )
  }
  return runtime
}

/** 构建 SPA hash 路由 URL，如 `/login` → `http://localhost:3399/#/login` */
export function buildHashRouteUrl(route: string): string {
  const { devServerUrl, indexHtml } = getElectronRuntime()
  const hash = route.startsWith("/") ? route : `/${route}`
  return devServerUrl
    ? `${devServerUrl}#${hash}`
    : `file://${indexHtml}#${hash}`
}

export function getPreloadPath(): string {
  return getElectronRuntime().preloadPath
}

export function getExtensionPreloadPath(): string {
  return getElectronRuntime().extensionPreloadPath
}

export function getAppIconPath(): string {
  const { appRoot } = getElectronRuntime()
  return `${appRoot}/build/icon.ico`
}
