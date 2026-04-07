import type { MetadataSkill } from "@/api/types"
import type { BlockType, QueryInterface, SkillBlockMapping } from "@/types/workbench"

/**
 * Default skill → block type mappings
 */
export const SKILL_BLOCK_MAPPINGS: SkillBlockMapping[] = [
  {
    skillPattern: /lark-base|飞书多维表格|bitable/i,
    blockType: "lark-bitable",
    title: "飞书表格",
  },
  {
    skillPattern: /data-analysis|数据统计|数据分析/i,
    blockType: "data-stats",
    title: "数据统计",
  },
  {
    skillPattern: /schedule|排班|shift/i,
    blockType: "schedule-view",
    title: "排班视图",
  },
]

/**
 * Get block type for a given skill name
 */
export function getBlockTypeForSkill(skill: MetadataSkill): BlockType {
  for (const mapping of SKILL_BLOCK_MAPPINGS) {
    if (mapping.skillPattern.test(skill.skillName)) {
      return mapping.blockType
    }
  }
  return "custom"
}

/**
 * Get block title for a given skill name
 */
export function getBlockTitleForSkill(skill: MetadataSkill): string {
  for (const mapping of SKILL_BLOCK_MAPPINGS) {
    if (mapping.skillPattern.test(skill.skillName)) {
      return mapping.title
    }
  }
  return skill.skillName
}

/**
 * Get block title for a given block type
 */
export function getBlockTitleForType(blockType: BlockType): string {
  const mapping = SKILL_BLOCK_MAPPINGS.find((m) => m.blockType === blockType)
  if (mapping) return mapping.title
  switch (blockType) {
    case "lark-bitable":
      return "飞书表格"
    case "data-stats":
      return "数据统计"
    case "schedule-view":
      return "排班视图"
    default:
      return "自定义"
  }
}

/**
 * Generate a unique block ID
 */
export function generateBlockId(blockType: BlockType, skillId: number | null): string {
  return `${blockType}-${skillId ?? "default"}-${Date.now()}`
}

/**
 * Generate a unique ID for query interface
 */
export function generateInterfaceId(): string {
  return `interface-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}
