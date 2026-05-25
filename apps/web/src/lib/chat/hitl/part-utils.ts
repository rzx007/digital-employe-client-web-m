export function toolPartHasFinalOutput(part: {
  state?: string
  output?: unknown
}): boolean {
  if (part.state === "output-available" || part.state === "output-error") {
    return true
  }
  return Boolean(part.output)
}
