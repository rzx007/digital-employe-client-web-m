import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { MessageResponse } from "@workspace/ui/components/ai-elements/message"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { adoptSkillCandidate, dismissSkillCandidate } from "@/api/employee"
import { chatKeys } from "@/lib/query-keys/chat"
import { useEmployeeGrowthBrain } from "@/hooks/use-employee-growth"

export function GrowthBrainSection({
  employeeId,
}: {
  employeeId: string | number | null
}) {
  const { data: brain, isLoading } = useEmployeeGrowthBrain(employeeId)
  const queryClient = useQueryClient()
  const [pendingSlug, setPendingSlug] = useState<string | null>(null)

  const refetchBrain = async () => {
    await queryClient.invalidateQueries({
      queryKey: ["employee-growth-brain", employeeId],
    })
    // 同步刷新联系人列表，让卡片上的「✨N」角标即时增减。
    await queryClient.invalidateQueries({ queryKey: chatKeys.contacts() })
  }

  const handleCandidateAction = async (
    slug: string,
    action: "adopt" | "dismiss"
  ) => {
    if (!employeeId || pendingSlug) return
    setPendingSlug(slug)
    try {
      if (action === "adopt") {
        await adoptSkillCandidate(employeeId, slug)
        toast.success(`已采纳技能「${slug}」`)
      } else {
        await dismissSkillCandidate(employeeId, slug)
        toast.success(`已忽略技能候选「${slug}」`)
      }
      await refetchBrain()
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : action === "adopt"
            ? "采纳失败"
            : "忽略失败"
      )
    } finally {
      setPendingSlug(null)
    }
  }

  if (!employeeId) return null
  if (isLoading)
    return (
      <div className="px-2 py-6 text-center text-sm text-muted-foreground">
        加载中…
      </div>
    )
  if (!brain) return null

  const candidates = brain.skill_candidates ?? []
  const hasAny =
    brain.profile_md ||
    brain.skills_list.length > 0 ||
    brain.memories_md ||
    brain.journal_entries.length > 0 ||
    candidates.length > 0

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

      {candidates.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>技能候选 · 待确认</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-xs text-muted-foreground">
              系统从该员工反复成功的打法中提炼出以下可复用技能，采纳后将成为其正式技能。
            </p>
            <div className="space-y-3">
              {candidates.map((c) => {
                const busy = pendingSlug === c.name
                return (
                  <div
                    key={c.name}
                    className="rounded-lg border bg-muted/30 p-3"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">
                        {c.zh || c.name}
                      </span>
                      <Badge variant="outline" className="text-[10px]">
                        {c.name}
                      </Badge>
                    </div>
                    {c.description ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {c.description}
                      </p>
                    ) : null}
                    <div className="mt-2.5 flex gap-1.5">
                      <Button
                        type="button"
                        size="sm"
                        className="h-7 text-xs"
                        disabled={busy}
                        onClick={() =>
                          void handleCandidateAction(c.name, "adopt")
                        }
                      >
                        {busy ? "处理中…" : "采纳"}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        disabled={busy}
                        onClick={() =>
                          void handleCandidateAction(c.name, "dismiss")
                        }
                      >
                        忽略
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
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
