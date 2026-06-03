// 把 CDP Accessibility.getFullAXTree 的节点数组解析为 @eN 引用列表。
// 纯函数、无 Electron 依赖，便于单测（见 ax-tree.test.ts）。

export interface RefNode {
  ref: string
  role: string
  name: string | null
  value: string | null
  backendNodeId: number
  depth: number
}

export interface AxNode {
  // CDP 的 AXNode.nodeId / childIds 是 string（AXNodeId），不是 number。
  nodeId?: string
  ignored?: boolean
  role?: { value?: string }
  name?: { value?: string }
  value?: { value?: string }
  backendDOMNodeId?: number
  childIds?: string[]
}

const MASKED_ROLES = new Set(["password"])

export function buildRefs(nodes: unknown[], maxNodes: number): RefNode[] {
  const refs: RefNode[] = []
  let counter = 0

  const nodeMap = new Map<string, AxNode>()
  for (const n of nodes) {
    const node = n as AxNode
    if (node.nodeId != null) nodeMap.set(String(node.nodeId), node)
  }

  const walk = (node: AxNode, depth: number) => {
    if (refs.length >= maxNodes) return
    const role = node.role?.value ?? "generic"
    // ignored 节点（wrapper / 布局容器）自身不暴露，但子节点可能是真正的可交互控件——
    // 必须透明穿透继续遍历，否则整棵子树被剪。
    if (node.ignored) {
      if (node.childIds) {
        for (const childId of node.childIds) {
          const child = nodeMap.get(String(childId))
          if (child) walk(child, depth)
        }
      }
      return
    }
    if (MASKED_ROLES.has(role)) {
      refs.push({
        ref: `@e${counter++}`,
        role,
        name: "[masked]",
        value: null,
        backendNodeId: node.backendDOMNodeId ?? 0,
        depth,
      })
      return
    }
    if (
      ["presentation", "none"].includes(role) &&
      !node.name?.value &&
      depth > 2
    ) {
      return
    }

    refs.push({
      ref: `@e${counter++}`,
      role,
      name: node.name?.value ?? null,
      value: node.value?.value ?? null,
      backendNodeId: node.backendDOMNodeId ?? 0,
      depth,
    })

    if (node.childIds) {
      for (const childId of node.childIds) {
        const child = nodeMap.get(String(childId))
        if (child) walk(child, depth + 1)
      }
    }
  }

  const root = nodes.find(
    (n) => (n as AxNode).role?.value === "RootWebArea"
  ) as AxNode | undefined
  if (root) walk(root, 0)
  else for (const n of nodes) walk(n as AxNode, 0)

  return refs
}
