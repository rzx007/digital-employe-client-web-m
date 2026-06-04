export function terminalToStreamState(status: string): string {
  // no_stream：后端任务尚未就绪，保持 streaming 以便前端重试 resume
  if (status === "no_stream") return "streaming"
  return status
}
