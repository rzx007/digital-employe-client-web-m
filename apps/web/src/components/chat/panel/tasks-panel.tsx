import { useEffect, useMemo, useState } from "react"
import {
  IconChevronDown,
  IconChevronRight,
  IconGitBranch,
  IconTerminal2,
  IconUser,
  IconX,
} from "@tabler/icons-react"

import { cn } from "@workspace/ui/lib/utils"

import { ExecutionReportCard } from "@/components/chat/message-blocks/execution-report-card"
import { formatExecutionDuration } from "@/components/chat/message-blocks/execution-card"
import { ToolOutputViewport } from "@/components/chat/message-blocks/tool-output-viewport"
import { useKillShellExecution } from "@/hooks/use-kill-shell-execution"
import { useShellExecutionOutput } from "@/hooks/use-shell-execution-output"
import type { ShellExecution } from "@/hooks/use-shell-executions"
import { useUnifiedTasks } from "@/hooks/use-unified-tasks"
import type {
  TaskKind,
  UnifiedTaskItem,
  UnifiedTaskStatus,
} from "@/lib/chat/unified-tasks"
import type { SubtaskCardItem } from "@/stores/tasks-panel-store"
import type { TaskExecution } from "@/types/schedule-monitor"

/** 把命令截断为标题回退文案。 */
function truncate(text: string, max = 48): string {
  if (text.length <= max) return text
  return `${text.slice(0, max - 1)}…`
}

/** mm:ss / hh:mm:ss 格式化秒数。 */
function formatElapsed(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const hours = Math.floor(s / 3600)
  const minutes = Math.floor((s % 3600) / 60)
  const seconds = s % 60
  const mm = String(minutes).padStart(2, "0")
  const ss = String(seconds).padStart(2, "0")
  if (hours > 0) return `${String(hours).padStart(2, "0")}:${mm}:${ss}`
  return `${mm}:${ss}`
}

/** 进行中行的实时计时器：从 started_wall 起算，每秒刷新。 */
function useLiveElapsed(startedWall: number, enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now() / 1000)
  useEffect(() => {
    if (!enabled) return
    const timer = setInterval(() => setNow(Date.now() / 1000), 1000)
    return () => clearInterval(timer)
  }, [enabled])
  return now - startedWall
}

const STATUS_META: Record<
  UnifiedTaskStatus,
  { label: string; className: string }
> = {
  running: {
    label: "进行中",
    className: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  },
  success: {
    label: "已完成",
    className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  },
  failed: {
    label: "失败",
    className: "bg-destructive/10 text-destructive",
  },
  killed: {
    label: "已终止",
    className: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  },
  timeout: {
    label: "超时",
    className: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  },
  queued: {
    label: "排队中",
    className: "bg-slate-500/10 text-slate-600 dark:text-slate-400",
  },
}

function StatusBadge({ status }: { status: UnifiedTaskStatus }) {
  const meta = STATUS_META[status]
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
        meta.className
      )}
    >
      {meta.label}
    </span>
  )
}

const KIND_META: Record<TaskKind, { label: string; Icon: typeof IconUser }> = {
  shell: { label: "命令", Icon: IconTerminal2 },
  subtask: { label: "子任务", Icon: IconGitBranch },
  employee: { label: "员工", Icon: IconUser },
}

/** 行首类型标识：图标 + 类型小标签，用于在混排列表里区分三类任务。 */
function KindBadge({ kind }: { kind: TaskKind }) {
  const { label, Icon } = KIND_META[kind]
  return (
    <span className="flex shrink-0 items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
      <Icon className="size-3" />
      {label}
    </span>
  )
}

/** 展开后的命令输出日志区。 */
function ShellTaskOutput({ exec }: { exec: ShellExecution }) {
  const {
    data: output,
    isPending,
    isError,
  } = useShellExecutionOutput(exec.session_id, {
    enabled: true,
    running: exec.running,
  })

  return (
    <div>
      <div className="text-[11px] font-medium text-muted-foreground/70">
        输出
      </div>
      {isPending ? (
        <div className="mt-1 rounded bg-background px-2 py-1.5 text-[11px] text-muted-foreground">
          加载中…
        </div>
      ) : isError ? (
        <div className="mt-1 rounded bg-background px-2 py-1.5 text-[11px] text-destructive">
          输出加载失败
        </div>
      ) : (
        <div className="mt-1 space-y-1">
          {output?.truncated_head ? (
            <div className="text-[11px] text-muted-foreground/60">
              …(更早输出已省略)
            </div>
          ) : null}
          <pre className="max-h-64 overflow-auto rounded bg-background px-2 py-1.5 font-mono text-[11px] whitespace-pre-wrap text-foreground/90">
            {output?.output?.trim() ? output.output : "(暂无输出)"}
          </pre>
        </div>
      )}
    </div>
  )
}

/** 后台命令行：类型标识 + 状态 + 实时耗时 + 退出码，可展开看命令/输出/终止。 */
function ShellRow({
  item,
  conversationId,
}: {
  item: UnifiedTaskItem
  conversationId: string | number | null | undefined
}) {
  const exec = item.shell!
  const [expanded, setExpanded] = useState(false)
  const liveElapsed = useLiveElapsed(exec.started_wall, exec.running)
  const elapsed = exec.running ? liveElapsed : exec.elapsed_seconds
  const title = exec.intent?.trim() || truncate(exec.command)
  const killExec = useKillShellExecution(conversationId)

  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <div className="flex items-start transition-colors hover:bg-muted/50">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex min-w-0 flex-1 items-start gap-2 px-3 py-2.5 text-left"
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <KindBadge kind="shell" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {title}
              </span>
              <StatusBadge status={item.status} />
            </div>
            <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
              <code className="min-w-0 flex-1 truncate font-mono text-[11px]">
                {exec.command}
              </code>
              <span className="shrink-0 tabular-nums">
                {formatElapsed(elapsed)}
              </span>
              {!exec.running && exec.exit_code != null ? (
                <span
                  className={cn(
                    "shrink-0 tabular-nums",
                    exec.exit_code === 0
                      ? "text-muted-foreground"
                      : "text-destructive"
                  )}
                >
                  code {exec.exit_code}
                </span>
              ) : null}
            </div>
          </div>
          {expanded ? (
            <IconChevronDown className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          ) : (
            <IconChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          )}
        </button>
        {exec.running ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              killExec.mutate(exec.session_id)
            }}
            disabled={killExec.isPending}
            className="mt-2 mr-2 shrink-0 self-start rounded px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:pointer-events-none disabled:opacity-50"
          >
            终止
          </button>
        ) : null}
      </div>

      {expanded ? (
        <div className="space-y-2 border-t bg-muted/30 px-3 py-2.5">
          <div>
            <div className="text-[11px] font-medium text-muted-foreground/70">
              命令
            </div>
            <pre className="mt-1 overflow-x-auto rounded bg-background px-2 py-1.5 font-mono text-[11px] whitespace-pre-wrap">
              {exec.command}
            </pre>
          </div>
          <ShellTaskOutput exec={exec} />
        </div>
      ) : null}
    </div>
  )
}

/** 子任务行（deepagents task 工具）：类型标识 + 状态，可展开看实时输出。 */
function SubtaskRow({ item }: { item: UnifiedTaskItem }) {
  const sub = item.subtask as SubtaskCardItem
  const title =
    sub.description.trim() ||
    (sub.subagentType ? `子任务 · ${sub.subagentType}` : "子任务")
  const hasOutput = !!sub.output && sub.output.trim().length > 0
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <div
        className={cn(
          "flex items-start gap-2 px-3 py-2.5 transition-colors",
          hasOutput && "cursor-pointer hover:bg-muted/50"
        )}
        onClick={hasOutput ? () => setExpanded((v) => !v) : undefined}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <KindBadge kind="subtask" />
            <span className="min-w-0 flex-1 truncate text-sm font-medium">
              {title}
            </span>
            <StatusBadge status={item.status} />
          </div>
          {hasOutput && !expanded ? (
            <span className="mt-1 block truncate text-[11px] text-muted-foreground">
              {sub.output}
            </span>
          ) : null}
        </div>
        {hasOutput ? (
          <span className="mt-0.5 shrink-0 text-muted-foreground">
            {expanded ? (
              <IconChevronDown className="size-4" />
            ) : (
              <IconChevronRight className="size-4" />
            )}
          </span>
        ) : null}
      </div>

      {hasOutput && expanded ? (
        <div
          className="border-t bg-muted/30 px-3 py-2.5"
          onClick={(e) => e.stopPropagation()}
        >
          <ToolOutputViewport
            text={sub.output ?? ""}
            isStreaming={item.status === "running"}
            showCursor={item.status === "running"}
            isError={item.status === "failed"}
          />
        </div>
      ) : null}
    </div>
  )
}

/**
 * 员工任务行：折叠态简化为「类型 + 任务名 + 员工 + 状态 + 耗时」，
 * 展开后才显示完整执行报告（输出 / 失败原因 / 工具足迹 / 评分 / 跳转 / 中止）。
 */
function EmployeeRow({
  item,
  curatorContactId,
  curatorConversationId,
}: {
  item: UnifiedTaskItem
  curatorContactId?: string | null
  curatorConversationId?: string | number | null
}) {
  const exec = item.employee as TaskExecution
  const [expanded, setExpanded] = useState(false)
  const durationLabel =
    exec.duration_ms != null && Number.isFinite(exec.duration_ms)
      ? formatExecutionDuration(exec.duration_ms)
      : null

  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-start gap-2 px-3 py-2.5 text-left transition-colors hover:bg-muted/50"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <KindBadge kind="employee" />
            <span className="min-w-0 flex-1 truncate text-sm font-medium">
              {exec.task_name}
            </span>
            <StatusBadge status={item.status} />
          </div>
          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
            <span className="min-w-0 flex-1 truncate">{exec.employee_name}</span>
            {durationLabel ? (
              <span className="shrink-0 tabular-nums">{durationLabel}</span>
            ) : null}
            {(exec.rework_count ?? 0) > 0 ? (
              <span className="shrink-0 text-amber-600 dark:text-amber-400">
                返工 {exec.rework_count} 次
              </span>
            ) : null}
          </div>
        </div>
        {expanded ? (
          <IconChevronDown className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        ) : (
          <IconChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        )}
      </button>

      {expanded ? (
        <div className="border-t bg-muted/30 px-3 py-2.5">
          <ExecutionReportCard
            execution={exec}
            curatorContactId={curatorContactId}
            curatorConversationId={curatorConversationId}
            className="rounded-none border-0 bg-transparent p-0 shadow-none"
          />
        </div>
      ) : null}
    </div>
  )
}

function TaskRow({
  item,
  conversationId,
  curatorContactId,
}: {
  item: UnifiedTaskItem
  conversationId: string | number | null
  curatorContactId?: string | null
}) {
  if (item.kind === "shell")
    return <ShellRow item={item} conversationId={conversationId} />
  if (item.kind === "subtask") return <SubtaskRow item={item} />
  return (
    <EmployeeRow
      item={item}
      curatorContactId={curatorContactId}
      curatorConversationId={conversationId}
    />
  )
}

/** 分区标题：进行中 / 已完成。 */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-1 pt-3 pb-1.5 text-[11px] font-medium tracking-wide text-muted-foreground/60 uppercase first:pt-0">
      {children}
    </div>
  )
}

/**
 * 合并任务面板 —— 子任务 / 后台命令 / 员工任务三类合一。
 * 顶层按状态分「进行中 / 已完成（含失败、中止、超时）」两组，组内按时间倒序混排，
 * 每行靠类型标识区分来源。
 */
export function TasksPanel({
  conversationId,
  curatorContactId,
  onClose,
  className,
}: {
  conversationId: string | number | null
  curatorContactId?: string | null
  onClose: () => void
  className?: string
}) {
  const items = useUnifiedTasks(conversationId)
  const running = useMemo(() => items.filter((i) => i.running), [items])
  const finished = useMemo(() => items.filter((i) => !i.running), [items])
  const total = items.length

  return (
    <div
      className={cn(
        "flex h-full min-w-0 flex-col overflow-hidden rounded-lg border bg-background shadow-xl",
        className
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <span className="flex shrink-0 items-center gap-2 text-sm font-semibold">
          任务
          {running.length > 0 ? (
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground tabular-nums">
              {running.length}
            </span>
          ) : null}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭"
          className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <IconX className="size-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2">
        {total === 0 ? (
          <div className="flex min-h-48 flex-col items-center justify-center px-4 text-center">
            <p className="text-sm text-muted-foreground">暂无任务</p>
            <p className="mt-1 text-xs text-muted-foreground/70">
              员工派发的子任务、后台命令与执行任务会在这里展示
            </p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {running.length > 0 ? (
              <>
                <SectionLabel>进行中 · {running.length}</SectionLabel>
                <div className="space-y-2">
                  {running.map((item) => (
                    <TaskRow
                      key={item.key}
                      item={item}
                      conversationId={conversationId}
                      curatorContactId={curatorContactId}
                    />
                  ))}
                </div>
              </>
            ) : null}
            {finished.length > 0 ? (
              <>
                <SectionLabel>已完成 · {finished.length}</SectionLabel>
                <div className="space-y-2">
                  {finished.map((item) => (
                    <TaskRow
                      key={item.key}
                      item={item}
                      conversationId={conversationId}
                      curatorContactId={curatorContactId}
                    />
                  ))}
                </div>
              </>
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}
