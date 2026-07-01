import { getIconForFilePath } from "vscode-material-icons"

// 基于 VS Code Material Icon Theme（vscode-material-icons 为其 Web 自托管封装）。
// 用 import.meta.glob 把包内全部 SVG 以 ?url 形式 eager 打包成哈希资源——
// Electron file:// 下也能正确解析（不依赖 public 绝对路径），且按需 tree-shake 由 Vite 处理。
const ICON_URLS = import.meta.glob<string>(
  "/node_modules/vscode-material-icons/generated/icons/*.svg",
  { query: "?url", import: "default", eager: true }
)

// key 形如 "/node_modules/vscode-material-icons/generated/icons/typescript.svg"
// → 建立 "typescript" → 资源URL 的查表
const URL_BY_NAME: Record<string, string> = {}
for (const [path, url] of Object.entries(ICON_URLS)) {
  const name = path.slice(path.lastIndexOf("/") + 1, -".svg".length)
  URL_BY_NAME[name] = url
}

if (import.meta.env.DEV && Object.keys(URL_BY_NAME).length === 0) {
  // glob 未命中（路径/符号链接问题）——退化为通用图标，控制台告警便于排查
  console.warn(
    "[file-icons] 未匹配到 vscode-material-icons 的 SVG，文件图标将全部回退为通用图标"
  )
}

/**
 * 按文件名（或完整路径）解析对应的 Material 文件类型图标 URL。
 * 覆盖数百种扩展名 + 特殊文件名（package.json、Dockerfile…），
 * 未知类型回退到通用 "file" 图标。可直接用于 <img src={...}>。
 */
export function getFileIcon(filename: string): string {
  const iconName = getIconForFilePath(filename) // e.g. "typescript" / "json" / "file"
  return URL_BY_NAME[iconName] ?? URL_BY_NAME["file"] ?? ""
}
