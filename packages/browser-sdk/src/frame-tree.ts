// 解析 CDP Page.getFrameTree 返回的 frame 树。纯函数，无 Electron 依赖，便于单测。

export interface FrameTreeNode {
  // CDP Page.Frame 只声明本模块需要的字段；将来需要 url/securityOrigin 等再扩展。
  frame: { id: string }
  childFrames?: FrameTreeNode[]
}

// 递归收集除根（主 frame）外的所有子 frame id（深度优先）。
export function collectChildFrames(tree: FrameTreeNode): string[] {
  const ids: string[] = []
  const visit = (node: FrameTreeNode) => {
    for (const child of node.childFrames ?? []) {
      ids.push(child.frame.id)
      visit(child)
    }
  }
  visit(tree)
  return ids
}
