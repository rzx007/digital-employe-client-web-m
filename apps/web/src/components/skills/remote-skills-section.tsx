import { IconSearch } from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import type { SkillListItem } from "@/api/types"
import { RemoteSkillCard } from "./remote-skill-card"
import { SKILLS_REMOTE_GRID_CLASS } from "./skill-grid"
import { SkillsCardGridSkeleton } from "./skills-grid-skeleton"

export function RemoteSkillsSection({
  loading,
  searchQuery,
  remoteCategory,
  filteredCount,
  categories,
  skills,
  skeletonCount,
  installingId,
  onCategoryChange,
  onSelectSkill,
  onInstall,
}: {
  loading: boolean
  searchQuery: string
  remoteCategory: string
  filteredCount: number
  categories: string[]
  skills: SkillListItem[]
  skeletonCount: number
  installingId: number | null
  onCategoryChange: (category: string) => void
  onSelectSkill: (skill: SkillListItem) => void
  onInstall: (skill: SkillListItem) => void
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-foreground">
        远程技能
        <span className="ml-1.5 font-normal text-muted-foreground">
          ({loading ? "—" : filteredCount})
        </span>
      </h2>

      {!loading && categories.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {categories.map((cat) => (
            <Button
              key={cat}
              type="button"
              variant={remoteCategory === cat ? "secondary" : "outline"}
              size="sm"
              className="h-7 rounded-full px-3 text-xs"
              onClick={() => onCategoryChange(cat)}
            >
              {cat}
            </Button>
          ))}
        </div>
      )}

      {loading ? (
        <SkillsCardGridSkeleton variant="remote" count={skeletonCount} />
      ) : skills.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-md border border-dashed py-12 text-muted-foreground">
          <IconSearch className="size-8 stroke-1" />
          <p className="mt-2 text-sm">
            {searchQuery || remoteCategory !== "全部"
              ? "当前分类下没有匹配的技能"
              : "暂无远程技能"}
          </p>
        </div>
      ) : (
        <div className={SKILLS_REMOTE_GRID_CLASS}>
          {skills.map((skill) => (
            <RemoteSkillCard
              key={skill.id}
              skill={skill}
              onSelect={() => onSelectSkill(skill)}
              onInstall={() => onInstall(skill)}
              installing={installingId === skill.id}
            />
          ))}
        </div>
      )}
    </section>
  )
}
