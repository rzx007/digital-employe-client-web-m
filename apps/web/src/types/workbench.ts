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

/** 看板尺寸档位。 */
export type GridSpanPreset = "small" | "medium" | "large" | "full"

/** 看板占据的网格跨度：w 列数、h 行数。 */
export interface GridSpan {
  w: number
  h: number
}

/** 看板左上角的网格坐标：x 起始列、y 起始行。 */
export interface GridPos {
  x: number
  y: number
}

/**
 * 工作台看板块：唯一类型为总管生成的 HTML 产物引用。
 * 布局采用规格化网格（gridSpan/gridPos），不再用像素 width/height。
 */
export interface WorkbenchBlock {
  id: string
  type: "html-artifact"
  title: string
  enabled: boolean
  order: number
  htmlRef: HtmlArtifactRef
  /** 网格跨度（列数/行数）。 */
  gridSpan: GridSpan
  /** 网格位置（起始列/行）。 */
  gridPos: GridPos
}

/**
 * 工作台配置（按 employeeId 存 localStorage，工作台用 "global"）。
 */
export interface WorkbenchConfig {
  employeeId: string
  blocks: WorkbenchBlock[]
  lastModified: number
  /** 被邀请进工作台的员工 id（切换器据此列出）。缺省视为 []。 */
  members?: number[]
}

/**
 * 总管 arrange_workbench 工具回吐的单条归一化指令。
 * 服务端已校验路径存在并把 span 档位归一化为具体 {w,h}。
 */
export type WorkbenchArrangeOp =
  | { op: "pin"; resourcePath: string; title?: string; span?: GridSpan; pos?: GridPos }
  | { op: "resize"; blockRef: string; span: GridSpan }
  | { op: "move"; blockRef: string; pos: GridPos }
  | { op: "rename"; blockRef: string; title: string }
  | { op: "hide"; blockRef: string }
  | { op: "remove"; blockRef: string }
  | { op: "reorder"; order: string[] }

/** 任务状态（task-status-badge / today-task-list 用，保留）。 */
export type TaskStatus =
  | "success"
  | "failed"
  | "pending"
  | "running"
  | "timeout"
  | "stuck"
  | "cancelled"
