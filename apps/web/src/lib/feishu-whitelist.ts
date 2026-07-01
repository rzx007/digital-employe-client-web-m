export function appendOpenId(existing: string, openId: string): string {
  const id = openId.trim()
  const list = existing
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
  if (!id) return list.join(",")
  if (!list.includes(id)) list.push(id)
  return list.join(",")
}
