import { broadcastAppearanceChanged } from "@/lib/theme/broadcast-appearance"

export type SkinBasis = "light" | "dark"

export interface SkinOption {
  id: string
  name: string
  basis: SkinBasis
}

/** localStorage 键：当前选中的特殊风格皮肤；空串表示无皮肤（走基础模式）。 */
export const SKIN_STORAGE_KEY = "appearance-skin"
/** 旧主题色键（已废弃），一次性迁移后删除。 */
const LEGACY_BRAND_KEY = "brand-theme"

/** 内置特殊风格皮肤。无皮肤时走 globals.css 的 :root / .dark 靛蓝默认。 */
export const SKINS: SkinOption[] = [
  { id: "guowang-green", name: "国网绿", basis: "light" },
  { id: "guowang-green-dark", name: "国网绿·夜", basis: "dark" },
  { id: "slate-light", name: "云朵舞者", basis: "light" },
  { id: "ocean-light", name: "晴空碧海", basis: "light" },
  { id: "forest-light", name: "森息晨光", basis: "light" },
  { id: "ocean-dark", name: "远山暮霭", basis: "dark" },
  { id: "forest-dark", name: "森息夜语", basis: "dark" },
  { id: "slate-dark", name: "莫兰迪夜", basis: "dark" },
  { id: "terminal-dark", name: "旧屏微光", basis: "dark" },
]

const BY_ID = new Map(SKINS.map((s) => [s.id, s]))

/** 旧主题色 id → 新皮肤 id 的一次性映射。teal/default → 无皮肤。 */
const LEGACY_MAP: Record<string, string> = {
  green: "guowang-green",
  teal: "",
  default: "",
}

/** 归一化为合法皮肤 id 或 ""（无皮肤）。 */
function normalize(id: string | null | undefined): string {
  if (!id) return ""
  if (BY_ID.has(id)) return id
  if (id in LEGACY_MAP) return LEGACY_MAP[id]
  return ""
}

/**
 * 读已存皮肤；用户没存过则回退 fallback（一般传品牌包 defaultTheme）。
 * 命中旧 brand-theme 残留时做一次性迁移：写入新键、删除旧键。
 */
export function getStoredSkin(fallback?: string): string {
  const stored = localStorage.getItem(SKIN_STORAGE_KEY)
  if (stored !== null) return normalize(stored)

  const legacy = localStorage.getItem(LEGACY_BRAND_KEY)
  if (legacy !== null) {
    const migrated = normalize(legacy)
    localStorage.setItem(SKIN_STORAGE_KEY, migrated)
    localStorage.removeItem(LEGACY_BRAND_KEY)
    return migrated
  }

  return normalize(fallback)
}

/** 应用皮肤的 DOM 副作用（属性 + 基调 class），不碰持久化。幂等。 */
export function applySkinToDOM(id: string): void {
  const root = document.documentElement
  const skin = BY_ID.get(id)
  if (!skin) {
    root.removeAttribute("data-theme")
    return
  }
  if (root.getAttribute("data-theme") !== id) {
    root.setAttribute("data-theme", id)
  }
  const wantDark = skin.basis === "dark"
  if (root.classList.contains("dark") !== wantDark) {
    root.classList.toggle("dark", wantDark)
  }
  if (root.classList.contains("light") !== !wantDark) {
    root.classList.toggle("light", !wantDark)
  }
}

/** 选皮肤：写 localStorage + apply DOM + 广播。id 空/非法时清皮肤回基础模式。 */
export function applySkin(id: string, options?: { broadcast?: boolean }): void {
  const next = normalize(id)
  localStorage.setItem(SKIN_STORAGE_KEY, next)
  applySkinToDOM(next)
  if (options?.broadcast !== false) {
    broadcastAppearanceChanged()
  }
}

/** 清皮肤：清 data-theme 与存储；基调 class 交回 ThemeProvider 重置。 */
export function clearSkin(options?: { broadcast?: boolean }): void {
  localStorage.setItem(SKIN_STORAGE_KEY, "")
  document.documentElement.removeAttribute("data-theme")
  if (options?.broadcast !== false) {
    broadcastAppearanceChanged()
  }
}

/** 当前是否激活了皮肤。 */
export function hasActiveSkin(): boolean {
  return normalize(localStorage.getItem(SKIN_STORAGE_KEY)) !== ""
}
