import defaultLogo from "@/assets/logo.png"

/**
 * 已解析品牌（renderer 端结构，与 electron/shared/brand.ts 的 ResolvedBrand 同形）。
 * 在此本地声明而非跨 import electron/，保持 renderer 与主进程解耦。
 */
export interface ResolvedBrand {
  productName: string
  windowTitle: string
  subtitle: string
  companyName: string
  /** 可含 {year} 占位 */
  copyright: string
  logos: { app: string; login: string; splash: string }
  defaultTheme?: string
}

/** 非 Electron（web/dev）兜底品牌。logo 用打包进的默认图。 */
export const WEB_DEFAULT_BRAND: ResolvedBrand = {
  productName: "数字员工",
  windowTitle: "BobanStaff",
  subtitle: "数字员工智能助手",
  companyName: "Bobandata",
  copyright: "© {year} Bobandata. All rights reserved.",
  logos: { app: defaultLogo, login: defaultLogo, splash: defaultLogo },
}
