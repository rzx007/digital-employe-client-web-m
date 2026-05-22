function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

export function formatTaskDuration(ms: number | null): string {
  if (ms == null) return "-"
  return formatDuration(ms)
}
