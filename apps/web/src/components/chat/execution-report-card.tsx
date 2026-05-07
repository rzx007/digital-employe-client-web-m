import * as React from "react"
import { useMutation } from "@tanstack/react-query"
import { IconExternalLink } from "@tabler/icons-react"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { MessageResponse } from "@workspace/ui/components/ai-elements/message"
import { cn } from "@workspace/ui/lib/utils"
import { submitSkillRating } from "@/api/skill-ratings"
import { useChatStore } from "@/stores/chat-store"
import { StarRating } from "./star-rating"
import type { TaskExecution } from "@/types/schedule-monitor"

const STATUS_CONFIG: Record<
  string,
  { label: string; className: string; stampText: string }
> = {
  success: {
    label: "成功",
    className:
      "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400",
    stampText: "已完成",
  },
  failed: {
    label: "失败",
    className:
      "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400",
    stampText: "失败",
  },
  timeout: {
    label: "超时",
    className:
      "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",
    stampText: "超时",
  },
  cancelled: {
    label: "已取消",
    className:
      "bg-gray-100 text-gray-600 dark:bg-gray-800/40 dark:text-gray-400",
    stampText: "已取消",
  },
}

export function ExecutionReportCard({
  execution,
  className,
}: {
  execution: TaskExecution
  className?: string
}) {
  const ratingMutation = useMutation({
    mutationFn: (score: number) =>
      submitSkillRating({
        task_execution_log_id: execution.id,
        score,
        comment: "",
      }),
  })

  const outputText = execution.output?.content ?? execution.run_result ?? ""
  const statusCfg = STATUS_CONFIG[execution.run_status]
  const isFinished =
    execution.run_status === "success" ||
    execution.run_status === "failed" ||
    execution.run_status === "timeout" ||
    execution.run_status === "cancelled"

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-lg border bg-card p-3 text-sm",
        className
      )}
    >
      {isFinished && statusCfg && (
        <div className="pointer-events-none absolute top-2.5 right-2.5 select-none">
          <div
            className={cn(
              "rounded border-2 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider opacity-20",
              execution.run_status === "success" &&
              "border-green-600 text-green-700 rotate-[-12deg] dark:border-green-400 dark:text-green-400",
              execution.run_status === "failed" &&
              "border-red-600 text-red-700 rotate-[-12deg] dark:border-red-400 dark:text-red-400",
              execution.run_status === "timeout" &&
              "border-amber-600 text-amber-700 rotate-[-12deg] dark:border-amber-400 dark:text-amber-400",
              execution.run_status === "cancelled" &&
              "border-gray-500 text-gray-600 rotate-[-12deg] dark:border-gray-400 dark:text-gray-400"
            )}
          >
            {statusCfg.stampText}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className={cn(
              "px-1.5 py-0 text-[10px]",
              statusCfg?.className ?? ""
            )}
          >
            {statusCfg?.label ?? execution.run_status}
          </Badge>
          <span className="text-[11px] text-muted-foreground truncate">
            {execution.task_name}
          </span>
        </div>

        {outputText && (
          <MessageResponse className="max-h-48 overflow-y-auto text-xs leading-relaxed text-muted-foreground [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
            {outputText}
          </MessageResponse>
        )}

        <div className="flex items-center gap-2 pt-0.5">
          <StarRating
            value={ratingMutation.data?.score ?? 0}
            onChange={(score) => ratingMutation.mutate(score)}
            size={12}
          />
          {execution.conversation_id && (
            <Button
              variant="ghost"
              size="icon-sm"
              className="size-5 shrink-0"
              aria-label="打开对应会话"
              onClick={() => {
                const { selectConversation, setActiveTab } =
                  useChatStore.getState()
                selectConversation(
                  String(execution.employee_id),
                  String(execution.conversation_id),
                )
                setActiveTab("chat")
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
