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
import {
  adoptSkillCandidate,
  dismissSkillCandidate,
  restoreSkill,
  pinSkill,
} from "@/api/employee"
import { chatKeys } from "@/lib/query-keys/chat"
import { useEmployeeGrowthBrain } from "@/hooks/use-employee-growth"

/** 成长履历中长列表（学习日志、技能修订）共用最大高度与滚动 */
const GROWTH_TIMELINE_LIST_CLASS =
  "max-h-64 space-y-2 overflow-y-auto overscroll-y-contain pr-0.5"

export function GrowthBrainSection({
  employeeId,
}: {
  employeeId: string | number | null
}) {
  const { data: brain, isLoading } = useEmployeeGrowthBrain(employeeId)
  const queryClient = useQueryClient()
  const [pendingSlug, setPendingSlug] = useState<string | null>(null)
  const [archivedExpanded, setArchivedExpanded] = useState(false)

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

  const handleRestore = async (name: string) => {
    if (!employeeId || pendingSlug) return
    setPendingSlug(`restore:${name}`)
    try {
      await restoreSkill(Number(employeeId), name)
      toast.success(`已恢复技能「${name}」`)
      await refetchBrain()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "恢复失败")
    } finally {
      setPendingSlug(null)
    }
  }

  const handlePin = async (name: string, currentPinned: boolean) => {
    if (!employeeId || pendingSlug) return
    const nextPinned = !currentPinned
    setPendingSlug(`pin:${name}`)
    try {
      await pinSkill(Number(employeeId), name, nextPinned)
      toast.success(nextPinned ? `已置顶技能「${name}」` : `已取消置顶「${name}」`)
      await refetchBrain()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "操作失败")
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
  const lifecycle = brain.skill_lifecycle ?? {}

  // 将 skills_list 按生命周期状态分组
  const activeSkills = brain.skills_list.filter(
    (name) => (lifecycle[name]?.status ?? "active") !== "archived"
  )
  const archivedSkills = brain.skills_list.filter(
    (name) => lifecycle[name]?.status === "archived"
  )

  const hasAny =
    brain.profile_md ||
    brain.skills_list.length > 0 ||
    brain.memories_md ||
    brain.journal_entries.length > 0 ||
    candidates.length > 0 ||
    (brain.recent_skill_edits?.length ?? 0) > 0 ||
    brain.archive_suggestion != null ||
    Object.keys(lifecycle).length > 0

  if (!hasAny) {
    return (
      <div className="px-2 py-6 text-center text-sm text-muted-foreground">
        该员工暂无成长记录（随着被派活会逐渐积累）。
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {brain.archive_suggestion != null ? (
        <Card className="border-muted bg-muted/40">
          <CardContent className="py-3 px-4 text-sm text-muted-foreground">
            该员工已闲置{" "}
            <span className="font-medium text-foreground">
              {brain.archive_suggestion.idle_days}
            </span>{" "}
            天未派活，可考虑归档。
          </CardContent>
        </Card>
      ) : null}

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
            {activeSkills.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {activeSkills.map((name) => {
                  const pinned = lifecycle[name]?.pinned ?? false
                  const busy = pendingSlug === `pin:${name}`
                  return (
                    <div key={name} className="flex items-center gap-1">
                      <Badge
                        variant="secondary"
                        className={pinned ? "border border-primary/40" : ""}
                      >
                        {pinned ? "★ " : ""}{name}
                      </Badge>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-5 w-5 p-0 text-[10px] text-muted-foreground hover:text-foreground"
                        disabled={busy || !!pendingSlug}
                        onClick={() => void handlePin(name, pinned)}
                        title={pinned ? "取消置顶" : "置顶"}
                      >
                        {pinned ? "★" : "☆"}
                      </Button>
                    </div>
                  )
                })}
              </div>
            ) : null}

            {archivedSkills.length > 0 ? (
              <div className={activeSkills.length > 0 ? "mt-3" : ""}>
                <button
                  type="button"
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => setArchivedExpanded((v) => !v)}
                >
                  <span>{archivedExpanded ? "▾" : "▸"}</span>
                  <span>已归档 ({archivedSkills.length})</span>
                </button>
                {archivedExpanded ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {archivedSkills.map((name) => {
                      const busy = pendingSlug === `restore:${name}`
                      return (
                        <div key={name} className="flex items-center gap-1">
                          <Badge
                            variant="outline"
                            className="text-muted-foreground line-through"
                          >
                            {name}
                          </Badge>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-5 px-1.5 text-[10px]"
                            disabled={busy || !!pendingSlug}
                            onClick={() => void handleRestore(name)}
                          >
                            {busy ? "…" : "恢复"}
                          </Button>
                        </div>
                      )
                    })}
                  </div>
                ) : null}
              </div>
            ) : null}
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
            <div className={GROWTH_TIMELINE_LIST_CLASS}>
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

      {(brain.recent_skill_edits?.length ?? 0) > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>技能修订记录</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={GROWTH_TIMELINE_LIST_CLASS}>
              {brain.recent_skill_edits!.map((e, i) => (
                <div
                  key={`${e.ts}-${i}`}
                  className="border-l-2 pl-3 py-1 text-sm"
                >
                  <p className="font-medium">{e.skill_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {`修订理由：${e.reason} · ${e.ts}`}
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
