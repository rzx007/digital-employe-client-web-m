/**
 * Workbench block types
 */
export type BlockType =
  | "lark-bitable"
  | "data-stats"
  | "schedule-view"
  | "custom"

/**
 * Query interface from skill prompt
 */
export interface QueryInterface {
  id: string
  name: string
  description: string
  method: "GET" | "POST" | "PUT" | "DELETE"
  path: string
  parameters?: Record<string, { type: string; description: string; required: boolean }>
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
  // For custom blocks
  queryInterface?: QueryInterface
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
export type TaskStatus = "success" | "failed" | "pending" | "running" | "timeout" | "stuck"
