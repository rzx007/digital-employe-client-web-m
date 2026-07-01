import { getResolvedBrand } from "../features/branding/brand-config"

/**
 * 用户可见产品名（菜单栏第一项、Dock、about 等与 electron-builder productName 语义对齐）。
 * 取自品牌包。必须惰性调用：APP_ROOT 在 index.ts 入口设置，早于此处求值会取不到品牌目录。
 */
export function getAppDisplayName(): string {
  return getResolvedBrand().productName
}
