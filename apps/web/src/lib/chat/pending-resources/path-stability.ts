function getBasename(path: string) {
  const segments = path.split("/").filter(Boolean)
  return segments.at(-1) ?? path
}

/** 流式 file_path 未写完时不应插入资源树，避免 ch / chapter- 等幽灵节点 */
export function isPathStableForPendingTree(path: string): boolean {
  const basename = getBasename(path)
  if (!basename || basename.length < 3) return false
  const dotIndex = basename.lastIndexOf(".")
  if (dotIndex <= 0 || dotIndex >= basename.length - 1) return false
  const ext = basename.slice(dotIndex + 1)
  return ext.length >= 1 && ext.length <= 12 && /^[a-z0-9]+$/i.test(ext)
}

export function getPendingDisplayName(pending: {
  path: string
  isStreaming: boolean
}): string {
  if (!pending.isStreaming || isPathStableForPendingTree(pending.path)) {
    return getBasename(pending.path)
  }
  return "正在创建文件…"
}

export function shouldMergePendingIntoTree(pending: {
  path: string
  isStreaming: boolean
}): boolean {
  if (!pending.isStreaming) return true
  return isPathStableForPendingTree(pending.path)
}
