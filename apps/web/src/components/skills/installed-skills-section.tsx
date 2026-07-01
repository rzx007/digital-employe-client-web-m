import { IconSearch } from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import type { SkillListItem } from "@/api/types"
import { InstalledSkillCard } from "./installed-skill-card"
import { SKILLS_GRID_CLASS } from "./skill-grid"
import { SkillsCardGridSkeleton } from "./skills-grid-skeleton"

export function InstalledSkillsSection({
  loading,
  searchQuery,
  filteredCount,
  skills,
  showToggle,
  expanded,
  onToggleExpanded,
  skeletonCount,
  onSelectSkill,
}: {
  loading: boolean
  searchQuery: string
  filteredCount: number
  skills: SkillListItem[]
  showToggle: boolean
  expanded: boolean
  onToggleExpanded: () => void
  skeletonCount: number
  onSelectSkill: (skill: SkillListItem) => void
}) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-foreground">
          已安装
          <span className="ml-1.5 font-normal text-muted-foreground">
            ({loading ? "—" : filteredCount})
          </span>
        </h2>
      </div>

      {loading ? (
        <SkillsCardGridSkeleton variant="installed" count={skeletonCount} />
      ) : skills.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-md border border-dashed py-12 text-muted-foreground">
          <IconSearch className="size-8 stroke-1" />
          <p className="mt-2 text-sm">
            {searchQuery
              ? "没有找到匹配的已安装技能"
              : "暂无已安装技能，点击「导入」添加 ZIP 包"}
          </p>
        </div>
      ) : (
        <>
          <div className={SKILLS_GRID_CLASS}>
            {skills.map((skill) => (
              <InstalledSkillCard
                key={`${skill.source}-${skill.id}-${skill.skillName}`}
                skill={skill}
                onClick={() => onSelectSkill(skill)}
              />
            ))}
          </div>
          {showToggle && (
            <div className="flex w-full justify-center pt-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-xs text-muted-foreground"
                onClick={onToggleExpanded}
              >
                {expanded ? "收起" : "显示更多"}
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  )
}
