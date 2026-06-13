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

function StatusIcon({ status }: { status: SubtaskStatus }) {
  if (status === "running") {
    return (
      <IconLoader className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
    )
  }
  if (status === "failed") {
    return <IconXboxX className="size-3.5 shrink-0 text-destructive/70" />
  }
  return <IconCircleCheck className="size-3.5 shrink-0 text-emerald-600/70" />
}

/**
 * 单个子任务行 —— Claude Code Background tasks 风格：扁平、低饱和、无彩色卡背景。
 * 左侧状态图标 + 标题（+ 副标题），可展开看实时输出。
 */
function SubtaskRow({ item }: { item: SubtaskCardItem }) {
  const status = statusOf(item)
  const title =
    item.description.trim() ||
    (item.subagentType ? `子任务 · ${item.subagentType}` : "子任务")
  const hasOutput = !!item.output && item.output.trim().length > 0
  const [isOpen, setIsOpen] = React.useState(false)
  const toggle = hasOutput ? () => setIsOpen((v) => !v) : undefined

  return (
    <div className="rounded-md">
      <div
        className={cn(
          "group/subtask flex items-start gap-2.5 rounded-md px-2.5 py-2 transition-colors",
          hasOutput && "cursor-pointer select-none hover:bg-muted/50"
        )}
        onClick={toggle}
      >
        <span className="mt-0.5">
          <StatusIcon status={status} />
        </span>
        <div className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-foreground/90">
            {title}
          </span>
          {hasOutput && !isOpen ? (
            <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
              {item.output}
            </span>
          ) : null}
        </div>
        {hasOutput ? (
          <span className="mt-0.5 shrink-0 text-muted-foreground/40">
            {isOpen ? (
              <IconChevronDown className="size-3.5" />
            ) : (
              <IconChevronRight className="size-3.5 opacity-0 transition-opacity group-hover/subtask:opacity-100" />
            )}
          </span>
        ) : null}
      </div>

      {hasOutput && isOpen ? (
        <div className="px-2.5 pb-2 pl-8" onClick={(e) => e.stopPropagation()}>
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

/** 分区标题：Running / Finished 风格的小标签。 */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2.5 pb-1 pt-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/60 first:pt-0">
      {children}
    </div>
  )
}

export function SubtaskPanel({ className }: { className?: string }) {
  const subtasks = useSubtaskPanelStore((s) => s.subtasks)
  const close = useSubtaskPanelStore((s) => s.close)

  const running = subtasks.filter((s) => statusOf(s) === "running")
  const finished = subtasks.filter((s) => statusOf(s) !== "running")
  const total = subtasks.length

  return (
    <div
      className={cn(
        "flex h-full min-w-0 flex-col overflow-hidden rounded-lg border bg-background shadow-xl",
        className
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <span className="flex shrink-0 items-center gap-2 text-sm font-semibold">
          子任务
          {total > 0 ? (
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground">
              {total}
            </span>
          ) : null}
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

      <div className="flex-1 overflow-y-auto px-2 py-2">
        {total === 0 ? (
          <div className="flex min-h-48 flex-col items-center justify-center px-4 text-center">
            <p className="text-sm text-muted-foreground">暂无子任务</p>
            <p className="mt-1 text-xs text-muted-foreground/70">
              员工派发并行子任务后会在这里展示
            </p>
          </div>
        ) : (
          <>
            {running.length > 0 ? (
              <>
                <SectionLabel>进行中 · {running.length}</SectionLabel>
                {running.map((item) => (
                  <SubtaskRow key={item.toolCallId} item={item} />
                ))}
              </>
            ) : null}
            {finished.length > 0 ? (
              <>
                <SectionLabel>已完成 · {finished.length}</SectionLabel>
                {finished.map((item) => (
                  <SubtaskRow key={item.toolCallId} item={item} />
                ))}
              </>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}
