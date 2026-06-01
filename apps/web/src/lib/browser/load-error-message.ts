/** Chromium net error → 用户可读提示（内嵌浏览器面板） */
export function formatBrowserLoadError(
  errorCode: number,
  errorDescription: string
): string | null {
  if (
    errorCode === -3 ||
    errorDescription.toLowerCase().includes("err_aborted")
  ) {
    return null
  }

  switch (errorCode) {
    case -105:
      return "无法解析域名（DNS），请检查网络或代理设置"
    case -106:
      return "未连接到互联网，请检查网络"
    case -118:
      return "连接超时，请检查网络或稍后重试"
    case -200:
    case -201:
      return "证书错误，请检查系统时间或 HTTPS 地址"
    case -300:
    case -301:
      return "重定向次数过多"
    case -2:
      return "地址无效或无法打开"
    default:
      break
  }

  const desc = errorDescription.trim()
  if (desc) return `${desc} (${errorCode})`
  return `加载失败 (${errorCode})`
}
