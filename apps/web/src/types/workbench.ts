/**
 * Workbench block types
 */
export type BlockType =
  | "lark-bitable"
  | "data-stats"
  | "schedule-view"
  | "custom"

/**
 * Chart display type for data visualization
 */
export type ChartDisplayType =
  | "pie"
  | "bar"
  | "line"
  | "table"
  | "metric"
  | "list"

/**
 * Query interface from skill prompt
 */
export interface QueryInterface {
  id: string
  name: string
  description: string
  method: "GET" | "POST" | "PUT" | "DELETE"
  path: string
  /** Full base URL including IP and port, e.g. http://192.168.1.100:8080 */
  baseUrl?: string
  /** Fixed chart type for display */
  chartType?: ChartDisplayType
  /** Request headers to include in API calls */
  headers?: Record<string, string>
  /** AI-analyzed field binding for chart display */
  fieldBinding?: {
    /** Field name for category/label axis */
    labelField?: string
    /** Field names for value axis (can be multiple for comparison) */
    valueFields?: string[]
  }
  /**
   * 技能正文中为接口字段标注的中文说明（如 JSON 示例里 `"price":"1",//单价`），用于数据板块表头/图例
   */
  fieldLabels?: Record<string, string>
  parameters?: Record<
    string,
    { type: string; description: string; required: boolean }
  >
  responseFormat?: string
}

/**
 * Skill block configuration stored in localStorage
 */
export interface WorkbenchBlock {
  id: string
  type: BlockType
  title: string
  enabled: boolean
  skillId: number | null
  order: number
  /** Fixed chart type for custom blocks */
  chartType?: ChartDisplayType
  // For custom blocks
  queryInterface?: QueryInterface
  /** Custom width in pixels (default: auto from grid) */
  width?: number
  /** Custom height in pixels */
  height?: number
}

/**
 * Workbench configuration for an employee
 */
export interface WorkbenchConfig {
  employeeId: string
  blocks: WorkbenchBlock[]
  lastModified: number
}

/**
 * Mapping from skill pattern to block type
 */
export interface SkillBlockMapping {
  skillPattern: RegExp
  blockType: BlockType
  title: string
}

/**
 * Task status for badge display
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
