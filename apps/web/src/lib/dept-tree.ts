export interface DeptTreeNode {
  id: number
  name: string
  children?: DeptTreeNode[]
}

export function pathsEqual(a: number[], b: number[]) {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

export function isPathSelected(paths: number[][], path: number[]) {
  return paths.some((p) => pathsEqual(p, path))
}

export function togglePath(paths: number[][], path: number[]): number[][] {
  const idx = paths.findIndex((p) => pathsEqual(p, path))
  if (idx >= 0) {
    return paths.filter((_, i) => i !== idx)
  }
  return [...paths, path]
}

const CHILD_KEYS = [
  "children",
  /** GET /yc/getDeptTree 实际字段 */
  "child",
  "childList",
  "childDeptList",
  "childDepts",
  "nodes",
  "subs",
  "departments",
  "list",
  "records",
  "rows",
  "tree",
] as const

function firstChildArray(o: Record<string, unknown>): unknown[] | null {
  for (const k of CHILD_KEYS) {
    const v = o[k]
    if (Array.isArray(v)) return v
  }
  return null
}

function pickId(o: Record<string, unknown>): number | null {
  const raw = o.id ?? o.deptId ?? o.departmentId ?? o.orgId ?? o.value ?? o.key
  if (raw === undefined || raw === null) return null
  if (typeof raw === "number" && !Number.isNaN(raw)) return raw
  if (typeof raw === "string") {
    const n = Number(raw)
    return Number.isNaN(n) ? null : n
  }
  return null
}

function pickName(o: Record<string, unknown>): string {
  const raw =
    o.name ??
    o.deptName ??
    o.departmentName ??
    o.orgName ??
    o.label ??
    o.title ??
    o.text ??
    ""
  return String(raw)
}

/**
 * 将接口返回的单节点（常见字段：id/deptId、name/deptName、children/childList…）转为 DeptTreeNode
 */
export function normalizeRawDeptNode(raw: unknown): DeptTreeNode | null {
  if (raw === null || typeof raw !== "object") return null
  const o = raw as Record<string, unknown>
  const id = pickId(o)
  if (id === null) return null
  const name = pickName(o)
  const arr = firstChildArray(o)
  let children: DeptTreeNode[] | undefined
  if (arr?.length) {
    children = arr
      .map((c) => normalizeRawDeptNode(c))
      .filter((n): n is DeptTreeNode => n !== null)
    if (!children.length) children = undefined
  }
  return { id, name: name || `部门 ${id}`, children }
}

/**
 * 解析任意形态的部门树数组或单根（GET /yc/getDeptTree 等）
 */
export function parseDeptTreePayload(raw: unknown): DeptTreeNode[] {
  if (!raw) return []
  if (Array.isArray(raw)) {
    return raw
      .map((n) => normalizeRawDeptNode(n))
      .filter((n): n is DeptTreeNode => n !== null)
  }
  if (typeof raw === "object") {
    const o = raw as Record<string, unknown>
    const nested = firstChildArray(o)
    if (nested?.length) return parseDeptTreePayload(nested)
    const one = normalizeRawDeptNode(raw)
    return one ? [one] : []
  }
  return []
}

/** 从树根沿 path 解析末端节点名称（用于选择摘要） */
export function deptPathDisplayLabel(
  roots: DeptTreeNode[],
  path: number[]
): string {
  let cur: DeptTreeNode[] | undefined = roots
  let label = ""
  for (const id of path) {
    const n = cur?.find((x) => x.id === id)
    if (!n) return path.join(" › ")
    label = n.name
    cur = n.children
  }
  return label || path.join(" › ")
}

/** 多选路径展示为「部门A、部门B」 */
export function formatSelectedDeptSummary(
  roots: DeptTreeNode[],
  paths: number[][]
): string {
  if (!paths.length) return ""
  return paths.map((p) => deptPathDisplayLabel(roots, p)).join("、")
}
