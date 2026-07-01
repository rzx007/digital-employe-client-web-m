export type WidgetType =
  | "kpi"
  | "line"
  | "bar"
  | "area"
  | "pie"
  | "table"
  | "progress"
  | "list"
  | "gauge"
  | "sparkline"
  | "radar"
  | "scatter"

export interface WidgetDataSource {
  metricId: string
  params?: Record<string, unknown>
  refreshSec?: number
}

export interface WorkbenchWidget {
  id: string
  type: WidgetType
  title: string
  subtitle?: string
  order: number
  width?: number
  height?: number
  data?: Record<string, any>
  dataSource?: WidgetDataSource
  options?: Record<string, any>
  /** 稳定业务键:后端 upsert 用(同 key 原地更新);前端透传保留 */
  key?: string
}

export interface HtmlArtifactRef {
  conversationId: string | number
  resourcePath: string
  pinnedAt: number
}

export interface HtmlTab {
  id: string
  title: string
  htmlRef: HtmlArtifactRef
}

export interface WorkbenchConfig {
  dashboard: { widgets: WorkbenchWidget[] }
  htmlTabs: HtmlTab[]
  tabOrder: string[]
  activeTabId?: string
  updatedAt: number
}

export const DASHBOARD_TAB_ID = "dashboard"

/**
 * 任务状态（task-status-badge / today-task-list 用，保留）
 */
export type TaskStatus =
  | "success"
  | "failed"
  | "pending"
  | "queued"
  | "running"
  | "timeout"
  | "stuck"
  | "cancelled"
  | "superseded"
