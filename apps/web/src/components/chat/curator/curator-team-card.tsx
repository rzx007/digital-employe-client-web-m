import { cn } from "@workspace/ui/lib/utils"
import { useContactsQuery } from "@/hooks/use-chat-queries"

/**
 * 团队名片（#6 团队能做什么）：在总管空状态展示现有数字员工 + 各自技能，
 * 让新用户一眼看清「这个团队能干什么」。纯只读，无员工时不渲染。
 */
export function CuratorTeamCard({
  className,
}: {
  className?: string
}) {
  const { data: contacts } = useContactsQuery()
  const employees = (contacts ?? [])
    .filter((c) => c.type === "employee" && c.employee)
    .map((c) => c.employee!)

  if (employees.length === 0) return null

  return (
    <div className={cn("w-full rounded-xl border bg-card/50 p-3", className)}>
      <p className="mb-2 text-xs font-medium text-muted-foreground">
        你的数字团队（{employees.length} 位）
      </p>
      <div className="space-y-2">
        {employees.slice(0, 6).map((emp) => {
          const allSkills = emp.skills ?? []
          const skills = allSkills.slice(0, 4)
          return (
            <div
              key={emp.id}
              className="flex flex-col gap-1 rounded-md bg-muted/40 px-2.5 py-1.5"
            >
              <div className="flex items-center gap-2">
                <span className="shrink-0 text-xs font-medium">{emp.name}</span>
                {emp.role ? (
                  <span className="truncate text-[11px] text-muted-foreground">
                    {emp.role}
                  </span>
                ) : null}
              </div>
              {skills.length > 0 ? (
                <div className="flex flex-wrap items-center gap-1">
                  {skills.map((s) => (
                    <span
                      key={s.id}
                      className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary"
                    >
                      {s.skill_name_zh ?? s.skillName}
                    </span>
                  ))}
                  {allSkills.length > 4 ? (
                    <span className="text-[10px] text-muted-foreground">
                      +{allSkills.length - 4}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
          )
        })}
        {employees.length > 6 ? (
          <p className="text-[10px] text-muted-foreground">
            …等 {employees.length} 位
          </p>
        ) : null}
      </div>
    </div>
  )
}
