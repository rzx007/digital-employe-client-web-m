import * as React from "react"
import { IconSearch } from "@tabler/icons-react"
import { Badge } from "@workspace/ui/components/badge"
import { Input } from "@workspace/ui/components/input"
import { fetchSkillList } from "@/api/employee"
import type { SkillListItem } from "@/api/types"
import { SkillDetailDialog } from "./skill-detail-dialog"

export function RemoteSkillList() {
  const [skills, setSkills] = React.useState<SkillListItem[]>([])
  const [loading, setLoading] = React.useState(true)
  const [searchQuery, setSearchQuery] = React.useState("")
  const [selectedSkill, setSelectedSkill] = React.useState<SkillListItem | null>(
    null
  )

  React.useEffect(() => {
    setLoading(true)
    fetchSkillList()
      .then(setSkills)
      .catch(() => setSkills([]))
      .finally(() => setLoading(false))
  }, [])

  const filteredSkills = React.useMemo(() => {
    if (!searchQuery.trim()) return skills
    const q = searchQuery.toLowerCase()
    return skills.filter(
      (item) =>
        item.skillName.toLowerCase().includes(q) ||
        item.description?.toLowerCase().includes(q) ||
        item.displayNameZh?.toLowerCase().includes(q) ||
        item.directoryName?.toLowerCase().includes(q)
    )
  }, [skills, searchQuery])

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <IconSearch className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="搜索远程技能..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <span className="shrink-0 text-sm text-muted-foreground">
          共 {filteredSkills.length} 项
        </span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <span className="text-sm">加载中...</span>
        </div>
      ) : filteredSkills.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <IconSearch className="size-8 stroke-1" />
          <p className="mt-2 text-sm">
            {searchQuery ? "没有找到匹配的技能" : "暂无远程技能"}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          {filteredSkills.map((skill) => (
            <button
              key={skill.id}
              type="button"
              className="flex flex-col gap-2 rounded-lg border p-4 text-left transition-colors hover:border-primary/30 hover:bg-accent/30"
              onClick={() => setSelectedSkill(skill)}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-sm font-medium leading-snug">
                  {skill.displayNameZh || skill.skillName}
                </span>
                <Badge variant="secondary" className="shrink-0 px-1.5 py-0 text-[10px]">
                  远程
                </Badge>
              </div>
              <span className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                {skill.description || "暂无描述"}
              </span>
              {skill.directoryName && (
                <Badge
                  variant="outline"
                  className="w-fit px-1.5 py-0 text-[10px]"
                >
                  {skill.directoryName}
                </Badge>
              )}
            </button>
          ))}
        </div>
      )}

      <SkillDetailDialog
        open={!!selectedSkill}
        onOpenChange={(open) => {
          if (!open) setSelectedSkill(null)
        }}
        skill={selectedSkill}
        source="remote"
      />
    </div>
  )
}
