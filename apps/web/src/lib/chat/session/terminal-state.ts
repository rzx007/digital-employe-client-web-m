export function terminalToStreamState(status: string): string {
  if (status === "no_stream") return "error"
  return status
}
