import { cn } from "@workspace/ui/lib/utils"
import type { SkillListItem } from "@/api/types"

export function isInstalledSource(s: SkillListItem): boolean {
  return s.source === "local" || s.source === "builtin"
}

export function sourceBadgeClassName(
  source: SkillListItem["source"] | undefined
): string {
  switch (source) {
    case "local":
      return cn(
        "border-sky-500/45 bg-sky-500/10 text-sky-900",
        "dark:border-sky-400/35 dark:bg-sky-400/15 dark:text-sky-100"
      )
    case "builtin":
      return cn(
        "border-amber-500/45 bg-amber-500/10 text-amber-950",
        "dark:border-amber-400/35 dark:bg-amber-400/15 dark:text-amber-50"
      )
    case "remote":
    default:
      return cn(
        "border-violet-500/45 bg-violet-500/10 text-violet-950",
        "dark:border-violet-400/35 dark:bg-violet-400/15 dark:text-violet-100/90"
      )
  }
}

export function sourceBadgeProps(source: SkillListItem["source"] | undefined) {
  return {
    variant: "outline" as const,
    className: cn(
      "shrink-0 px-1.5 py-0 text-[10px] font-medium",
      sourceBadgeClassName(source)
    ),
  }
}

export function buildRemoteCategories(skills: SkillListItem[]): string[] {
  const hasTag = skills.some((s) => (s.tags?.length ?? 0) > 0)
  if (hasTag) {
    const set = new Set<string>()
    let untagged = false
    for (const s of skills) {
      if (s.tags?.length) {
        for (const t of s.tags) {
          if (t.trim()) set.add(t.trim())
        }
      } else {
        untagged = true
      }
    }
    const sorted = [...set].sort((a, b) => a.localeCompare(b, "zh-CN"))
    return ["全部", ...sorted, ...(untagged ? ["未分类"] : [])]
  }
  const set = new Set<string>()
  for (const s of skills) {
    set.add(s.directoryName?.trim() || "未分类")
  }
  const sorted = [...set].sort((a, b) => a.localeCompare(b, "zh-CN"))
  return ["全部", ...sorted]
}

export function filterRemoteByCategory(
  skills: SkillListItem[],
  category: string
): SkillListItem[] {
  if (category === "全部") return skills
  const hasTag = skills.some((s) => (s.tags?.length ?? 0) > 0)
  if (hasTag) {
    if (category === "未分类") {
      return skills.filter((s) => !(s.tags?.length ?? 0))
    }
    return skills.filter((s) => s.tags?.includes(category))
  }
  return skills.filter(
    (s) => (s.directoryName?.trim() || "未分类") === category
  )
}

export function filterSkillsBySearch(
  skills: SkillListItem[],
  searchQuery: string,
  options?: { includeDirectoryAndTags?: boolean }
): SkillListItem[] {
  if (!searchQuery.trim()) return skills
  const q = searchQuery.toLowerCase()
  return skills.filter((item) => {
    const base =
      item.skillName.toLowerCase().includes(q) ||
      item.description?.toLowerCase().includes(q) ||
      item.displayNameZh?.toLowerCase().includes(q)
    if (!options?.includeDirectoryAndTags) return base
    return (
      base ||
      item.directoryName?.toLowerCase().includes(q) ||
      item.tags?.some((t) => t.toLowerCase().includes(q))
    )
  })
}
