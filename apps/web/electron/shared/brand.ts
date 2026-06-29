/** 已解析品牌（logo 字段为 data URL 字符串）。main/preload/renderer 共用。 */
export interface ResolvedBrand {
  productName: string
  windowTitle: string
  subtitle: string
  companyName: string
  /** 可含 {year} 占位，渲染时替换为当前年 */
  copyright: string
  logos: { app: string; login: string; splash: string }
  /** 可选：品牌默认主题色预设 id（见 renderer brand-theme.ts） */
  defaultTheme?: string
}

/** brand.json 原始结构（logo 为相对文件名）。 */
export interface BrandManifest {
  productName?: string
  windowTitle?: string
  subtitle?: string
  companyName?: string
  copyright?: string
  logos?: { app?: string; login?: string; splash?: string }
  defaultTheme?: string
}

/** 兜底默认（对齐现 BobanStaff 标识）。logo 为空串，renderer/main 各自补默认图。 */
export const DEFAULT_BRAND: ResolvedBrand = {
  productName: "数字员工",
  windowTitle: "BobanStaff",
  subtitle: "数字员工智能助手",
  companyName: "Bobandata",
  copyright: "© {year} Bobandata. All rights reserved.",
  logos: { app: "", login: "", splash: "" },
}
