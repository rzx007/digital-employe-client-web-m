import * as React from "react"
import { useMutation } from "@tanstack/react-query"
import { IconExternalLink } from "@tabler/icons-react"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { submitSkillRating } from "@/api/skill-ratings"
import { useChatStore } from "@/stores/chat-store"
import { EmployeeContactAvatar } from "./contact-avatars"
import { StarRating } from "./star-rating"
import type { ExecutionReport } from "@/stores/execution-reports-store"

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  success: {
    label: "成功",
    className: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400",
  },
  failed: {
    label: "失败",
    className: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400",
  },
}

function truncateText(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max) + "..."
}

export function ExecutionReportCard({
  report,
  className,
}: {
  report: ExecutionReport
  className?: string
}) {
  const contacts = useChatStore((s) => s.contacts)
  const employee = React.useMemo(
    () => contacts.find((c) => c.type === "employee" && c.employee?.id === String(report.employeeId)),
    [contacts, report.employeeId]
  )

  const ratingMutation = useMutation({
    mutationFn: (score: number) =>
      submitSkillRating({
        workspace_id: 1,
        employee_id: report.employeeId,
        score,
      }),
  })

  return (
    <div className={cn("flex items-start gap-3 rounded-lg border bg-card p-3 text-sm", className)}>
      <button
        type="button"
        className="shrink-0 rounded-full transition-all hover:ring-2 hover:ring-primary/30"
        onClick={() => {
          useChatStore.getState().switchToContact(String(report.employeeId))
        }}
      >
        <EmployeeContactAvatar
          name={employee?.employee?.name ?? report.employeeName}
          avatar={employee?.employee?.avatar}
          avatarClassName="size-8"
          fallbackClassName="text-xs"
        />
      </button>

      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium">{report.employeeName}</span>
          <Badge
            variant="outline"
            className={cn(
              "px-1.5 py-0 text-[10px]",
              STATUS_CONFIG[report.status]?.className ?? ""
            )}
          >
            {STATUS_CONFIG[report.status]?.label ?? report.status}
          </Badge>
          <span className="text-[10px] text-muted-foreground">
            {report.taskName}
          </span>
        </div>

        {report.outputText && (
          <p className="text-xs text-muted-foreground leading-relaxed">
            {truncateText(report.outputText, 200)}
          </p>
        )}

        <div className="flex items-center gap-2 pt-0.5">
          <StarRating
            value={ratingMutation.data?.score ?? 0}
            onChange={(score) => ratingMutation.mutate(score)}
            size={12}
          />
          {report.conversationId && (
            <Button
              variant="ghost"
              size="icon-sm"
              className="size-5"
              onClick={() => {
                useChatStore.getState().switchToContact(String(report.employeeId))
              }}
            >
              <IconExternalLink className="size-3" />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
