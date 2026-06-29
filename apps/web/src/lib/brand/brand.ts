import * as React from "react"

import type { ResolvedBrand } from "./default-brand"
import { WEB_DEFAULT_BRAND } from "./default-brand"

export type { ResolvedBrand }

/**
 * Electron 下读 preload 注入的 window.brand，否则用 web 兜底。
 * 缺 logo（如 active 包未带图）时逐项回退默认图，避免裂图。
 */
export function getBrand(): ResolvedBrand {
  const injected = (window as Window & { brand?: ResolvedBrand }).brand
  if (!injected) return WEB_DEFAULT_BRAND
  return {
    ...injected,
    logos: {
      app: injected.logos?.app || WEB_DEFAULT_BRAND.logos.app,
      login:
        injected.logos?.login ||
        injected.logos?.app ||
        WEB_DEFAULT_BRAND.logos.login,
      splash:
        injected.logos?.splash ||
        injected.logos?.app ||
        WEB_DEFAULT_BRAND.logos.splash,
    },
  }
}

/** 把 {year} 替换为当前年（版权行用）。 */
export function withYear(s: string): string {
  return s.replace(/\{year\}/g, String(new Date().getFullYear()))
}

/** 组件里用：品牌是启动即定的常量，无需 context / 订阅。 */
export function useBrand(): ResolvedBrand {
  return React.useMemo(() => getBrand(), [])
}
