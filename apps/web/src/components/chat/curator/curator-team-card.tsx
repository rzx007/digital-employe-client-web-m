import { IconMessageCircle } from "@tabler/icons-react"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { EmployeeContactAvatar } from "@/components/chat/contacts/contact-avatars"
import { useContactsQuery } from "@/hooks/use-chat-queries"
import type { AIEmployee } from "@/types/chat"

function skillLabelsFromEmployee(
  skills: Array<{ skill_name_zh?: string | null; skillName?: string }>
): string[] {
  return skills
    .map((s) => s.skill_name_zh ?? s.skillName)
    .filter((label): label is string => Boolean(label))
}

function resolveEmployeeIntro(emp: AIEmployee): string {
  const role = emp.role?.trim() ?? ""
  const specialty = emp.specialty?.trim() ?? ""

  if (role && specialty && role !== specialty) {
    return `${specialty} · ${role}`
  }

  return role || specialty
}

/**
 * 团队名片（#6 团队能做什么）：在总管空状态展示现有数字员工 + 各自技能，
 * 让新用户一眼看清「这个团队能干什么」。纯只读，无员工时不渲染。
 */
export function CuratorTeamCard({
  className,
  onMentionEmployee,
  mentionDisabled = false,
}: {
  className?: string
  onMentionEmployee?: (employee: { id: string; name: string }) => void
  mentionDisabled?: boolean
}) {
  const { data: contacts } = useContactsQuery()
  const employees = (contacts ?? [])
    .filter((c) => c.type === "employee" && c.employee)
    .map((c) => c.employee!)

  if (employees.length === 0) return null

  return (
    <div className={cn("w-full rounded-xl border bg-card p-3", className)}>
      <p className="mb-2 text-xs font-medium text-muted-foreground">
        你的数字团队（{employees.length} 位）
      </p>
      <div className="max-h-[min(22rem,55vh)] divide-y overflow-y-auto rounded-lg border bg-card/80">
        {employees.slice(0, 6).map((emp) => {
          const skillLabels = skillLabelsFromEmployee(emp.skills ?? []).slice(
            0,
            3
          )
          const remainingSkills =
            (emp.skills?.length ?? 0) - skillLabels.length
          const intro = resolveEmployeeIntro(emp)

          return (
            <div
              key={emp.id}
              className="flex items-start gap-2 px-3 py-2"
            >
              <EmployeeContactAvatar
                name={emp.name}
                avatarClassName="size-8 shrink-0 rounded-lg"
                fallbackClassName="rounded-lg bg-primary/10 text-[10px] font-medium text-primary"
              />
              <div
                className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-1"
                title={
                  intro ? `${emp.name} · ${intro}` : emp.name
                }
              >
                <span className="shrink-0 text-sm font-medium">{emp.name}</span>
                {intro ? (
                  <>
                    <span
                      className="shrink-0 text-[11px] text-muted-foreground/60"
                      aria-hidden
                    >
                      ·
                    </span>
                    <span className="min-w-0 truncate text-[11px] text-muted-foreground">
                      {intro}
                    </span>
                  </>
                ) : null}
                {skillLabels.map((label) => (
                  <Badge
                    key={label}
                    variant="outline"
                    className="h-5 max-w-[7rem] shrink-0 truncate px-1.5 text-[10px] font-normal"
                    title={label}
                  >
                    {label}
                  </Badge>
                ))}
                {remainingSkills > 0 ? (
                  <Badge
                    variant="outline"
                    className="h-5 shrink-0 px-1.5 text-[10px] font-normal text-muted-foreground"
                  >
                    +{remainingSkills}
                  </Badge>
                ) : null}
              </div>
              {onMentionEmployee ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                  disabled={mentionDisabled}
                  aria-label={`@${emp.name}`}
                  title={`在输入框 @${emp.name}`}
                  onClick={() =>
                    onMentionEmployee({
                      id: String(emp.id),
                      name: emp.name,
                    })
                  }
                >
                  <IconMessageCircle className="size-4" />
                </Button>
              ) : null}
            </div>
          )
        })}
      </div>
      {employees.length > 6 ? (
        <p className="mt-2 text-[10px] text-muted-foreground">
          …等 {employees.length} 位
        </p>
      ) : null}
    </div>
  )
}
