import { useEffect, useState } from "react"
import {
  IconChevronDown,
  IconChevronRight,
  IconTerminal2,
  IconX,
} from "@tabler/icons-react"

import { cn } from "@workspace/ui/lib/utils"

import { useShellExecutionOutput } from "@/hooks/use-shell-execution-output"
import {
  useShellExecutions,
  type ShellExecution,
} from "@/hooks/use-shell-executions"

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

/** 分区标题：进行中 / 已完成。 */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-1 pt-3 pb-1.5 text-[11px] font-medium tracking-wide text-muted-foreground/60 uppercase first:pt-0">
      {children}
    </div>
  )
}

function StatusBadge({ exec }: { exec: ShellExecution }) {
  const label =
    exec.status === "running"
      ? "进行中"
      : exec.status === "killed"
        ? "已终止"
        : "已完成"
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
        exec.status === "running"
          ? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
          : exec.status === "killed"
            ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
            : exec.exit_code === 0
              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              : "bg-destructive/10 text-destructive"
      )}
    >
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

function ShellTaskCard({ exec }: { exec: ShellExecution }) {
  const [expanded, setExpanded] = useState(false)
  const liveElapsed = useLiveElapsed(exec.started_wall, exec.running)
  const elapsed = exec.running ? liveElapsed : exec.elapsed_seconds
  const title = exec.intent?.trim() || truncate(exec.command)

  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-start gap-2 px-3 py-2.5 text-left transition-colors hover:bg-muted/50"
      >
        <IconTerminal2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-sm font-medium">
              {title}
            </span>
            <StatusBadge exec={exec} />
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
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              状态
              <StatusBadge exec={exec} />
            </span>
            {!exec.running && exec.exit_code != null ? (
              <span className="tabular-nums">退出码 {exec.exit_code}</span>
            ) : null}
            <span className="tabular-nums">耗时 {formatElapsed(elapsed)}</span>
          </div>
          <ShellTaskOutput exec={exec} />
        </div>
      ) : null}
    </div>
  )
}

/**
 * 常驻「后台命令」面板 —— Claude-Code Background tasks 式。
 * 展示当前会话下发的后台 shell 命令（状态 + 耗时 + 退出码），分进行中 / 已完成两区。
 * 数据走 `useShellExecutions`（10s 轮询 + SSE invalidate 近实时）。
 */
export function ShellTasksPanel({
  conversationId,
  onClose,
  className,
}: {
  conversationId: string | number | null
  onClose: () => void
  className?: string
}) {
  const {
    data: executions = [],
    isPending,
    isError,
    refetch,
  } = useShellExecutions(conversationId)

  const running = executions.filter((e) => e.running)
  const finished = executions.filter((e) => !e.running)
  const total = executions.length

  return (
    <div
      className={cn(
        "flex h-full min-w-0 flex-col overflow-hidden rounded-lg border bg-background shadow-xl",
        className
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <span className="flex shrink-0 items-center gap-2 text-sm font-semibold">
          后台命令
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
        {isError && total === 0 ? (
          <div className="flex min-h-48 flex-col items-center justify-center gap-2 px-4 text-center">
            <p className="text-sm text-muted-foreground">加载失败</p>
            <button
              type="button"
              onClick={() => void refetch()}
              className="rounded border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              点击重试
            </button>
          </div>
        ) : total === 0 ? (
          <div className="flex min-h-48 flex-col items-center justify-center px-4 text-center">
            <p className="text-sm text-muted-foreground">
              {isPending ? "加载中…" : "暂无后台命令"}
            </p>
            {!isPending ? (
              <p className="mt-1 text-xs text-muted-foreground/70">
                员工执行的后台命令会在这里展示运行状态与结果
              </p>
            ) : null}
          </div>
        ) : (
          <div className="space-y-1.5">
            {running.length > 0 ? (
              <>
                <SectionLabel>进行中 · {running.length}</SectionLabel>
                <div className="space-y-2">
                  {running.map((exec) => (
                    <ShellTaskCard key={exec.session_id} exec={exec} />
                  ))}
                </div>
              </>
            ) : null}
            {finished.length > 0 ? (
              <>
                <SectionLabel>已完成 · {finished.length}</SectionLabel>
                <div className="space-y-2">
                  {finished.map((exec) => (
                    <ShellTaskCard key={exec.session_id} exec={exec} />
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
