import { MessageResponse } from "@workspace/ui/components/ai-elements/message"
import { Badge } from "@workspace/ui/components/badge"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { useEmployeeGrowthBrain } from "@/hooks/use-employee-growth"

export function GrowthBrainSection({
  employeeId,
}: {
  employeeId: string | number | null
}) {
  const { data: brain, isLoading } = useEmployeeGrowthBrain(employeeId)

  if (!employeeId) return null
  if (isLoading)
    return (
      <div className="px-2 py-6 text-center text-sm text-muted-foreground">
        加载中…
      </div>
    )
  if (!brain) return null

  const hasAny =
    brain.profile_md ||
    brain.skills_list.length > 0 ||
    brain.memories_md ||
    brain.journal_entries.length > 0

  if (!hasAny) {
    return (
      <div className="px-2 py-6 text-center text-sm text-muted-foreground">
        该员工暂无成长记录（随着被派活会逐渐积累）。
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {brain.profile_md ? (
        <Card>
          <CardHeader>
            <CardTitle>能力画像</CardTitle>
          </CardHeader>
          <CardContent>
            <MessageResponse>{brain.profile_md}</MessageResponse>
          </CardContent>
        </Card>
      ) : null}

      {brain.skills_list.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>技能</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {brain.skills_list.map((name) => (
                <Badge key={name} variant="secondary">
                  {name}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {brain.memories_md ? (
        <Card>
          <CardHeader>
            <CardTitle>长期记忆</CardTitle>
          </CardHeader>
          <CardContent>
            <MessageResponse>{brain.memories_md}</MessageResponse>
          </CardContent>
        </Card>
      ) : null}

      {brain.journal_entries.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>学习日志</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {brain.journal_entries.map((e, i) => (
                <div
                  key={`${e.ts}-${i}`}
                  className="border-l-2 pl-3 py-1 text-sm"
                >
                  <p className="font-medium">
                    {e.task_name || "（未命名任务）"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {e.status}
                    {e.duration_ms != null ? ` · ${e.duration_ms}ms` : ""}
                    {e.ts ? ` · ${e.ts}` : ""}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
