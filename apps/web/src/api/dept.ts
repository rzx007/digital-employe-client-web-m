import { request } from "@/lib/request"
import type { DeptTreeNode } from "@/lib/dept-tree"
import { parseDeptTreePayload } from "@/lib/dept-tree"

export type { DeptTreeNode } from "@/lib/dept-tree"

export interface DeptTreeResponse {
  code: number
  msg?: string
  result?: unknown
  data?: unknown
}

function pickTreePayload(res: DeptTreeResponse): unknown {
  const r = res.result ?? res.data
  if (r === undefined || r === null) return undefined
  if (Array.isArray(r)) return r
  if (typeof r === "object") {
    const o = r as Record<string, unknown>
    for (const key of [
      "list",
      "records",
      "rows",
      "tree",
      "nodes",
      "children",
      "child",
      "departments",
      "data",
    ]) {
      const v = o[key]
      if (Array.isArray(v)) return v
    }
    return r
  }
  return r
}

function unwrapDeptTreeResult(raw: unknown): DeptTreeNode[] {
  return parseDeptTreePayload(raw)
}

/**
 * 部门树（GET /yc/getDeptTree：顶层 `data` 数组；节点含 `child`、name/deptName/title）
 *
 * GET /yc/getDeptTree
 */
export async function getDeptTree(): Promise<{
  code: number
  msg?: string
  nodes: DeptTreeNode[]
}> {
  const res = await request<DeptTreeResponse>("/yc/getDeptTree", {
    method: "GET",
  })
  const nodes = unwrapDeptTreeResult(pickTreePayload(res))
  return { code: res.code, msg: res.msg, nodes }
}
