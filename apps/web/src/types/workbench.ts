/**
 * 指向某个总管会话产出的 HTML 产物文件
 */
export interface HtmlArtifactRef {
  /** 产出该 HTML 的总管会话 */
  conversationId: string | number
  /** 会话内资源路径，如 /artifacts/sales-dashboard.html */
  resourcePath: string
  /** 钉住时间戳 */
  pinnedAt: number
}

/**
 * 工作台看板块：唯一类型为总管生成的 HTML 产物引用
 */
export interface WorkbenchBlock {
  id: string
  type: "html-artifact"
  title: string
  enabled: boolean
  order: number
  htmlRef: HtmlArtifactRef
  /** 自定义宽度（像素），沿用现有网格逻辑 */
  width?: number
  /** 自定义高度（像素） */
  height?: number
}

/**
 * 工作台配置（按 employeeId 存 localStorage，工作台用 "global"）
 */
export interface WorkbenchConfig {
  employeeId: string
  blocks: WorkbenchBlock[]
  lastModified: number
}

/**
 * 任务状态（task-status-badge / today-task-list 用，保留）
 */
export type TaskStatus =
  | "success"
  | "failed"
  | "pending"
  | "running"
  | "timeout"
  | "stuck"
  | "cancelled"
