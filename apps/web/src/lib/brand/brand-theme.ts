import { broadcastAppearanceChanged } from "@/lib/theme/broadcast-appearance"

export const BRAND_THEME_STORAGE_KEY = "brand-theme"

export interface BrandThemeOption {
  id: string
  label: string
  description: string
  /** 预览色块（oklch/hex 均可） */
  swatch: string
}

/** 内置主题色预设。default 走 globals.css 根变量；其余靠 data-brand-theme 覆盖。 */
export const BRAND_THEMES: BrandThemeOption[] = [
  {
    id: "default",
    label: "靛蓝（默认）",
    description: "默认品牌色",
    swatch: "oklch(0.488 0.243 264.376)",
  },
  {
    id: "green",
    label: "国网绿",
    description: "国家电网风格",
    swatch: "oklch(0.55 0.13 155)",
  },
  {
    id: "teal",
    label: "青蓝",
    description: "清爽青蓝",
    swatch: "oklch(0.6 0.12 200)",
  },
]

const VALID = new Set(BRAND_THEMES.map((t) => t.id))

/**
 * 读已存预设；用户没存过则回退到 fallback（一般传品牌包的 defaultTheme），
 * fallback 也非法时回退 default。
 */
export function getStoredBrandTheme(fallback = "default"): string {
  const v = localStorage.getItem(BRAND_THEME_STORAGE_KEY)
  if (v && VALID.has(v)) return v
  return VALID.has(fallback) ? fallback : "default"
}

/** 应用预设：default 清属性（走 :root 根变量），其余写 data-brand-theme，并持久化。 */
export function applyBrandTheme(
  id: string,
  options?: { broadcast?: boolean }
): void {
  const next = VALID.has(id) ? id : "default"
  localStorage.setItem(BRAND_THEME_STORAGE_KEY, next)
  const root = document.documentElement
  if (next === "default") root.removeAttribute("data-brand-theme")
  else root.setAttribute("data-brand-theme", next)
  if (options?.broadcast !== false) {
    broadcastAppearanceChanged()
  }
}
