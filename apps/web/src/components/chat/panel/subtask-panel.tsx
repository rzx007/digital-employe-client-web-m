import * as React from "react"
import {
  IconCircleCheck,
  IconChevronDown,
  IconChevronRight,
  IconLoader,
  IconX,
  IconXboxX,
} from "@tabler/icons-react"

import { cn } from "@workspace/ui/lib/utils"

import { ToolOutputViewport } from "@/components/chat/message-blocks/tool-output-viewport"
import {
  useSubtaskPanelStore,
  type SubtaskCardItem,
} from "@/stores/subtask-panel-store"

/** 子任务状态语义与 tool-action-row 对齐：output-available/无 preliminary → done，
 * output-error → failed，其余（含 preliminary 的初步输出）→ running。 */
type SubtaskStatus = "running" | "done" | "failed"

function statusOf(item: SubtaskCardItem): SubtaskStatus {
  if (item.state === "output-error") return "failed"
  if (item.state === "output-available" && !item.preliminary) return "done"
  return "running"
}

/** 状态 → 颜色/文案（沿用 group-sop-panel 的配色体系） */
const STATUS_META: Record<
  SubtaskStatus,
  { label: string; dot: string; text: string; card: string }
> = {
  running: {
    label: "进行中",
    dot: "bg-blue-500",
    text: "text-blue-600",
    card: "border-blue-300 bg-blue-50/60 ring-1 ring-blue-200/60",
  },
  done: {
    label: "已完成",
    dot: "bg-emerald-500",
    text: "text-emerald-600",
    card: "border-emerald-200 bg-emerald-50/50",
  },
  failed: {
    label: "失败",
    dot: "bg-red-500",
    text: "text-red-600",
    card: "border-red-200 bg-red-50/50",
  },
}

function StatusIcon({ status }: { status: SubtaskStatus }) {
  if (status === "running") {
    return <IconLoader className="size-3.5 shrink-0 animate-spin text-blue-500" />
  }
  if (status === "failed") {
    return <IconXboxX className="size-3.5 shrink-0 text-red-500/80" />
  }
  return <IconCircleCheck className="size-3.5 shrink-0 text-emerald-500/80" />
}

function SubtaskCard({ item }: { item: SubtaskCardItem }) {
  const status = statusOf(item)
  const meta = STATUS_META[status]
  const title =
    item.description.trim() ||
    (item.subagentType ? `子任务 · ${item.subagentType}` : "子任务")
  const hasOutput = !!item.output && item.output.trim().length > 0
  const [isOpen, setIsOpen] = React.useState(false)
  const toggle = hasOutput ? () => setIsOpen((v) => !v) : undefined

  return (
    <div
      className={cn(
        "rounded-xl border px-3 py-2 transition-colors",
        meta.card,
        hasOutput && "cursor-pointer select-none hover:shadow-sm"
      )}
      onClick={toggle}
    >
      <div className="flex items-start gap-2">
        <span
          className={cn(
            "mt-1 size-2.5 shrink-0 rounded-full",
            meta.dot,
            status === "running" && "animate-pulse"
          )}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">
              {title}
            </span>
            <span
              className={cn(
                "shrink-0 rounded-full bg-background/70 px-1.5 py-0.5 text-[10px] font-medium",
                meta.text
              )}
            >
              {meta.label}
            </span>
            {hasOutput &&
              (isOpen ? (
                <IconChevronDown className="size-3.5 shrink-0 text-muted-foreground/50" />
              ) : (
                <IconChevronRight className="size-3.5 shrink-0 text-muted-foreground/50" />
              ))}
          </div>
          {item.subagentType && item.description.trim() ? (
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
              {item.subagentType}
            </p>
          ) : null}
          {hasOutput && !isOpen ? (
            <p className="mt-1 line-clamp-2 text-[11.5px] leading-relaxed text-muted-foreground">
              {item.output}
            </p>
          ) : null}
        </div>
        <span className="mt-0.5">
          <StatusIcon status={status} />
        </span>
      </div>

      {hasOutput && isOpen ? (
        <div className="mt-2" onClick={(e) => e.stopPropagation()}>
          <ToolOutputViewport
            text={item.output ?? ""}
            isStreaming={status === "running"}
            showCursor={status === "running"}
            isError={status === "failed"}
          />
        </div>
      ) : null}
    </div>
  )
}

export function SubtaskPanel({ className }: { className?: string }) {
  const subtasks = useSubtaskPanelStore((s) => s.subtasks)
  const close = useSubtaskPanelStore((s) => s.close)

  const runningCount = subtasks.filter((s) => statusOf(s) === "running").length
  const doneCount = subtasks.filter((s) => statusOf(s) === "done").length
  const total = subtasks.length
  const pct = total ? Math.round((doneCount / total) * 100) : 0

  return (
    <div
      className={cn(
        "flex h-full min-w-0 flex-col overflow-hidden rounded-lg border bg-background shadow-xl",
        className
      )}
    >
      <div className="border-b px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <span className="flex shrink-0 items-center gap-1.5 text-sm font-semibold">
            <span aria-hidden>🧩</span>
            并行子任务
          </span>
          <div className="flex items-center gap-2">
            <span className="text-xs tabular-nums text-muted-foreground">
              {doneCount}/{total} 完成
              {runningCount > 0 ? ` · ${runningCount} 进行中` : ""}
            </span>
            <button
              type="button"
              onClick={close}
              aria-label="关闭"
              className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <IconX className="size-4" />
            </button>
          </div>
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-emerald-500 transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {total === 0 ? (
          <div className="flex min-h-48 flex-col items-center justify-center px-4 text-center">
            <span className="mb-2 text-2xl" aria-hidden>
              🧩
            </span>
            <p className="text-sm text-muted-foreground">本轮暂无并行子任务</p>
            <p className="mt-1 text-xs text-muted-foreground/80">
              员工派发并行子任务后会在这里展示
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {subtasks.map((item) => (
              <SubtaskCard key={item.toolCallId} item={item} />
            ))}
          </div>
        )}
      </div>

      <div className="border-t px-4 py-2 text-[11px] leading-relaxed text-muted-foreground">
        每张卡片是一个并行子任务，点击展开查看实时输出。
      </div>
    </div>
  )
}
