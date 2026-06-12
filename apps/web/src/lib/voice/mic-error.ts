/** 把 getUserMedia / MediaRecorder 抛出的异常映射为用户可读的中文文案。 */
export function describeMicError(err: unknown): string {
  const name =
    err instanceof DOMException ? err.name : err instanceof Error ? err.name : ""

  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return "需要麦克风权限：请在系统或浏览器设置中允许本应用访问麦克风"
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "未检测到麦克风：请连接麦克风后重试"
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return "麦克风被占用：请关闭其他使用麦克风的应用后重试"
  }

  return err instanceof Error ? `无法开始录音：${err.message}` : "无法开始录音"
}
