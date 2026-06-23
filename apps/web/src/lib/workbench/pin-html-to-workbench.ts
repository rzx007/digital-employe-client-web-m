import {
  addHtmlArtifactBlock,
  emitWorkbenchConfigChanged,
  GLOBAL_WORKBENCH_ID,
  initializeWorkbenchConfig,
  loadWorkbenchConfig,
} from "./workbench-config"

/**
 * 把一个 HTML 产物钉到全局工作台网格。
 * 资源面板右键「钉到工作台」与资源池拖入网格共用此函数（直接读写 localStorage 并广播刷新）。
 */
export function pinHtmlToWorkbench(args: {
  conversationId: string | number
  path: string
  name: string
  /** 资源池来源时传资源条目 id；渲染走 /workbench-resources/{id}/content。 */
  resourceId?: number
}): void {
  const { conversationId, path, name, resourceId } = args
  const config =
    loadWorkbenchConfig(GLOBAL_WORKBENCH_ID) ??
    initializeWorkbenchConfig(GLOBAL_WORKBENCH_ID)
  const title = name.replace(/\.html?$/i, "")
  addHtmlArtifactBlock(
    config,
    {
      conversationId,
      resourcePath: path,
      pinnedAt: Date.now(),
      ...(resourceId != null ? { resourceId } : {}),
    },
    title
  )
  // 通知 WorkbenchView 重读配置（钉住即出现，无需切菜单）
  emitWorkbenchConfigChanged()
}
