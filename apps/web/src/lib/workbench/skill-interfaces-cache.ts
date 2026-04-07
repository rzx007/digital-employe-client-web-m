import type { MetadataSkill } from "@/api/types"
import type { QueryInterface } from "@/types/workbench"

const STORAGE_PREFIX = "workbench-skill-ifaces-v1:"

/** 内存缓存，同一会话内读写最快 */
const memory = new Map<string, QueryInterface[]>()

function storageKey(cacheKey: string): string {
  return `${STORAGE_PREFIX}${cacheKey}`
}

/** 员工 + 已启用技能的变更签名，技能内容更新后自动视为新缓存键 */
export function getSkillInterfacesCacheKey(employeeId: string, skills: MetadataSkill[]): string {
  const sig = skills
    .filter((s) => s.status === 1)
    .map((s) => `${s.id}:${s.updateTime}`)
    .sort()
    .join("|")
  return `${employeeId}::${sig}`
}

export function getCachedParsedInterfaces(cacheKey: string): QueryInterface[] | null {
  const m = memory.get(cacheKey)
  if (m) return m
  if (typeof sessionStorage === "undefined") return null
  try {
    const raw = sessionStorage.getItem(storageKey(cacheKey))
    if (!raw) return null
    const parsed = JSON.parse(raw) as QueryInterface[]
    memory.set(cacheKey, parsed)
    return parsed
  } catch {
    return null
  }
}

export function setCachedParsedInterfaces(cacheKey: string, interfaces: QueryInterface[]): void {
  memory.set(cacheKey, interfaces)
  try {
    sessionStorage.setItem(storageKey(cacheKey), JSON.stringify(interfaces))
  } catch {
    /* 配额或隐私模式：仅保留内存 */
  }
}

export function invalidateSkillInterfacesCache(cacheKey: string): void {
  memory.delete(cacheKey)
  try {
    sessionStorage.removeItem(storageKey(cacheKey))
  } catch {
    /* ignore */
  }
}
