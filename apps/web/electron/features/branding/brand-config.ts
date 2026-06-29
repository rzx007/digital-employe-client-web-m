import { existsSync, readFileSync } from "node:fs"
import { extname, isAbsolute, join } from "node:path"

import type { BrandManifest, ResolvedBrand } from "../../shared/brand"
import { DEFAULT_BRAND } from "../../shared/brand"

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
}

function fileToDataUrl(path: string): string {
  const mime = MIME[extname(path).toLowerCase()] ?? "application/octet-stream"
  const b64 = readFileSync(path).toString("base64")
  return `data:${mime};base64,${b64}`
}

function readLogo(dir: string, name: string | undefined): string {
  if (!name) return ""
  const p = isAbsolute(name) ? name : join(dir, name)
  return existsSync(p) ? fileToDataUrl(p) : ""
}

/** 把字符串里的 {year} 占位替换为给定年份。 */
export function substituteYear(s: string, year: number): string {
  return s.replace(/\{year\}/g, String(year))
}

/**
 * 从指定目录读 brand.json + logo，逐项回退 DEFAULT_BRAND。
 * brand.json 损坏/缺失 → 整体回退；单个 logo 缺失 → 该项回退到 app（再回退空串）。
 */
export function loadBrandFromDir(dir: string): ResolvedBrand {
  let m: BrandManifest = {}
  const jsonPath = join(dir, "brand.json")
  if (existsSync(jsonPath)) {
    try {
      m = JSON.parse(readFileSync(jsonPath, "utf-8")) as BrandManifest
    } catch {
      m = {}
    }
  }
  const appLogo = readLogo(dir, m.logos?.app)
  return {
    productName: m.productName ?? DEFAULT_BRAND.productName,
    windowTitle: m.windowTitle ?? DEFAULT_BRAND.windowTitle,
    subtitle: m.subtitle ?? DEFAULT_BRAND.subtitle,
    companyName: m.companyName ?? DEFAULT_BRAND.companyName,
    copyright: m.copyright ?? DEFAULT_BRAND.copyright,
    logos: {
      app: appLogo,
      login: readLogo(dir, m.logos?.login) || appLogo,
      splash: readLogo(dir, m.logos?.splash) || appLogo,
    },
    defaultTheme: m.defaultTheme,
  }
}

function hasManifest(dir: string | undefined): dir is string {
  return !!dir && existsSync(join(dir, "brand.json"))
}

/**
 * 解析品牌目录（先到先用，纯 process.* / 文件系统，不依赖 electron）：
 * 1. DE_BRANDING_DIR（测试 / 临时覆盖）
 * 2. <resourcesPath>/branding/active（deploy.sh 拷入的选定品牌）
 * 3. <resourcesPath>/branding/default（打包内兜底）
 * 4. <APP_ROOT>/branding/default（开发态：index.ts 已设 process.env.APP_ROOT）
 */
export function resolveBrandingDir(): string {
  const env = process.env.DE_BRANDING_DIR
  if (hasManifest(env)) return env

  const resources = process.resourcesPath
  if (resources) {
    const active = join(resources, "branding", "active")
    if (hasManifest(active)) return active
    const packed = join(resources, "branding", "default")
    if (hasManifest(packed)) return packed
  }

  const appRoot = process.env.APP_ROOT
  if (appRoot) return join(appRoot, "branding", "default")

  // 最末兜底：当前工作目录下的 branding/default（极少触发）。
  return join(process.cwd(), "branding", "default")
}

let cached: ResolvedBrand | null = null

/** 缓存解析结果（启动一次即定）。 */
export function getResolvedBrand(): ResolvedBrand {
  if (!cached) cached = loadBrandFromDir(resolveBrandingDir())
  return cached
}
