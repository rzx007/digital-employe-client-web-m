import type { MetadataSkill } from "@/api/types"
import type { QueryInterface } from "@/types/workbench"

const STORAGE_PREFIX = "workbench-skill-ifaces-v1:"

/** 内存缓存，同一会话内读写最快 */
const memory = new Map<string, QueryInterface[]>()

function storageKey(cacheKey: string): string {
  return `${STORAGE_PREFIX}${cacheKey}`
}

/** 员工 + 技能变更签名；传入 focusedSkill 时仅对该技能签名（与当前解析/chat/send 上下文一致） */
export function getSkillInterfacesCacheKey(
  employeeId: string,
  skills: MetadataSkill[],
  focusedSkill?: MetadataSkill | null,
): string {
  const source =
    focusedSkill != null ? [focusedSkill] : skills
  const sig = source
    .filter((s) => s.status === undefined || s.status === 1 || s.status === "1")
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
