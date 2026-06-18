"use client"

import * as React from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import {
  NativeSelect,
  NativeSelectOption,
} from "@workspace/ui/components/native-select"
import { Textarea } from "@workspace/ui/components/textarea"
import {
  fetchOrchestrationPlanDetail,
  updateOrchestrationPlanTask,
} from "@/api/orchestration"
import { useContactsQuery } from "@/hooks/use-chat-queries"
import { chatKeys } from "@/lib/query-keys/chat"

/**
 * 待确认编排计划的子任务编辑弹窗（inline-edit v1：仅改 prompt / 换员工）。
 * 打开时拉取计划实时子任务（含 prompt+employee_id）；逐任务独立保存。
 */
export function PlanEditDialog({
  planId,
  open,
  onOpenChange,
  onSaved,
}: {
  planId: number
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved?: () => void
}) {
  const queryClient = useQueryClient()
  const { data: contacts } = useContactsQuery()

  const employees = React.useMemo(
    () =>
      (contacts ?? [])
        .filter((c) => c.type === "employee" && c.employee)
        .map((c) => ({ id: Number(c.employee!.id), name: c.employee!.name })),
    [contacts]
  )

  const planQuery = useQuery({
    queryKey: [...chatKeys.all, "orchestration-plan-detail", planId],
    queryFn: ({ signal }) => fetchOrchestrationPlanDetail(planId, { signal }),
    enabled: open,
    staleTime: 0,
  })

  // 每个任务的本地编辑态：prompt / employeeId / 保存中。
  const [drafts, setDrafts] = React.useState<
    Record<number, { prompt: string; employeeId: number }>
  >({})
  const [savingId, setSavingId] = React.useState<number | null>(null)

  const planTasks = planQuery.data?.tasks ?? []

  React.useEffect(() => {
    if (planQuery.data) {
      const next: Record<number, { prompt: string; employeeId: number }> = {}
      for (const t of planQuery.data.tasks) {
        next[t.task_id] = { prompt: t.prompt, employeeId: t.employee_id }
      }
      setDrafts(next)
    }
  }, [planQuery.data])

  const handleSave = async (taskId: number) => {
    const draft = drafts[taskId]
    if (!draft || savingId) return
    setSavingId(taskId)
    try {
      await updateOrchestrationPlanTask(planId, taskId, {
        prompt: draft.prompt,
        employee_id: draft.employeeId,
      })
      toast.success("子任务已更新")
      await planQuery.refetch()
      onSaved?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "编辑失败")
    } finally {
      setSavingId(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>编辑计划子任务</DialogTitle>
          <DialogDescription>
            确认执行前可改派活说明或更换员工；多人协作请保持员工不同。
          </DialogDescription>
        </DialogHeader>

        {planQuery.isLoading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            加载中…
          </p>
        ) : planTasks.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            无可编辑的子任务。
          </p>
        ) : (
          <div className="space-y-4">
            {planTasks.map((t) => {
              const draft = drafts[t.task_id] ?? {
                prompt: t.prompt,
                employeeId: t.employee_id,
              }
              const busy = savingId === t.task_id
              return (
                <div key={t.task_id} className="rounded-lg border p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">
                      {t.task_name}
                    </span>
                    <NativeSelect
                      size="sm"
                      value={String(draft.employeeId)}
                      disabled={busy}
                      onChange={(e) =>
                        setDrafts((prev) => ({
                          ...prev,
                          [t.task_id]: {
                            ...draft,
                            employeeId: Number(e.target.value),
                          },
                        }))
                      }
                    >
                      {employees.length === 0 ? (
                        <NativeSelectOption value={String(draft.employeeId)}>
                          {t.employee_name || `员工 #${draft.employeeId}`}
                        </NativeSelectOption>
                      ) : (
                        employees.map((emp) => (
                          <NativeSelectOption key={emp.id} value={String(emp.id)}>
                            {emp.name}
                          </NativeSelectOption>
                        ))
                      )}
                    </NativeSelect>
                  </div>
                  <Textarea
                    value={draft.prompt}
                    disabled={busy}
                    rows={3}
                    className="text-xs"
                    onChange={(e) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [t.task_id]: { ...draft, prompt: e.target.value },
                      }))
                    }
                  />
                  <div className="mt-2 flex justify-end">
                    <Button
                      type="button"
                      size="sm"
                      className="h-7 text-xs"
                      disabled={busy}
                      onClick={() => void handleSave(t.task_id)}
                    >
                      {busy ? "保存中…" : "保存"}
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
