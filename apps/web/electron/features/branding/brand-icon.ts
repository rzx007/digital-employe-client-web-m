import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { app, nativeImage } from "electron"

import { resolveBrandingDir } from "./brand-config"

export interface BrandIconPaths {
  /** Windows 窗口 / 托盘 */
  ico: string
  /** macOS / Linux / 通知 / favicon 源 */
  png: string
  /** macOS Dock（可选） */
  icns?: string
}

function firstExisting(...paths: string[]): string | undefined {
  return paths.find((p) => existsSync(p))
}

function manifestAppLogoPath(brandDir: string): string | undefined {
  const jsonPath = join(brandDir, "brand.json")
  if (!existsSync(jsonPath)) return undefined
  try {
    const m = JSON.parse(readFileSync(jsonPath, "utf-8")) as {
      logos?: { app?: string }
    }
    const name = m.logos?.app
    if (!name) return undefined
    const p = join(brandDir, name)
    return existsSync(p) ? p : undefined
  } catch {
    return undefined
  }
}

/**
 * 解析品牌包内的系统图标路径（窗口 / 托盘 / Dock / 通知）。
 * 查找顺序（每个文件名）：品牌根目录 → 品牌根/build/ → 打包内 build/。
 * png 额外回退 logos.app 与 logo.png。
 */
export function resolveBrandIconPaths(appRoot: string): BrandIconPaths {
  const brandDir = resolveBrandingDir()
  const buildSub = join(brandDir, "build")
  const bundled = {
    ico: join(appRoot, "build/icon.ico"),
    png: join(appRoot, "build/icon.png"),
    icns: join(appRoot, "build/icon.icns"),
  }

  const ico =
    firstExisting(join(brandDir, "icon.ico"), join(buildSub, "icon.ico")) ??
    bundled.ico

  const png =
    firstExisting(
      join(brandDir, "icon.png"),
      join(buildSub, "icon.png"),
      manifestAppLogoPath(brandDir),
      join(brandDir, "logo.png"),
    ) ?? bundled.png

  const icns = firstExisting(
    join(brandDir, "icon.icns"),
    join(buildSub, "icon.icns"),
  )

  return { ico, png, icns: icns ?? undefined }
}

/** 当前平台 BrowserWindow / 托盘应使用的图标文件路径。 */
export function getAppIconPathForPlatform(appRoot: string): string {
  const paths = resolveBrandIconPaths(appRoot)
  return process.platform === "win32" ? paths.ico : paths.png
}

/** macOS Dock 图标（有 icns 优先，否则 png）。 */
export function applyBrandDockIcon(appRoot: string): void {
  if (process.platform !== "darwin" || !app.dock) return
  const { png, icns } = resolveBrandIconPaths(appRoot)
  const path = icns && existsSync(icns) ? icns : png
  const image = nativeImage.createFromPath(path)
  if (!image.isEmpty()) app.dock.setIcon(image)
}
