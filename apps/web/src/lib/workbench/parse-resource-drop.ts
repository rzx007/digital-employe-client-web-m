export interface DroppedResource {
  id: number
  src_path: string
  title: string
  source: "employee_artifact" | "upload"
}

/** 从 dragData（资源池卡片拖拽载荷）解析；非本类型 / 非法返回 null。 */
export function parseResourceDrop(raw: string | null): DroppedResource | null {
  if (!raw) return null
  try {
    const obj = JSON.parse(raw)
    if (
      typeof obj?.id === "number" &&
      typeof obj?.src_path === "string" &&
      typeof obj?.title === "string"
    ) {
      return {
        id: obj.id,
        src_path: obj.src_path,
        title: obj.title,
        source: obj.source === "upload" ? "upload" : "employee_artifact",
      }
    }
  } catch {
    /* ignore */
  }
  return null
}
