"use client"

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { IconActivity, IconX } from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { fetchRuntimeConfig } from "@/api/system"
import type {
  StreamMetricsInflight,
  StreamMetricsRecent,
  StreamMetricsSummary,
} from "@/lib/runtime/runtime-types"

const STORAGE_KEY = "stream-metrics-overlay-open"
const DEV_MODE_KEY = "stream-metrics-dev-mode"

function useDevMode() {
  const [devMode, setDevMode] = React.useState<boolean>(() => {
    if (typeof window === "undefined") return false
    return window.localStorage.getItem(DEV_MODE_KEY) === "1"
  })

  React.useEffect(() => {
    if (typeof window === "undefined") return
    let buf = ""
    let timer: number | undefined
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || !e.shiftKey) return
      const k = e.key.toLowerCase()
      if (!/^[a-z]$/.test(k)) return
      buf += k
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        buf = ""
      }, 1500)
      if (buf.endsWith("devon")) {
        window.localStorage.setItem(DEV_MODE_KEY, "1")
        setDevMode(true)
        buf = ""
      } else if (buf.endsWith("devoff")) {
        window.localStorage.removeItem(DEV_MODE_KEY)
        window.localStorage.removeItem(STORAGE_KEY)
        setDevMode(false)
        buf = ""
      }
    }
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("keydown", onKey)
      window.clearTimeout(timer)
    }
  }, [])

  return devMode
}

function useOverlayToggle(enabled: boolean) {
  const [open, setOpen] = React.useState<boolean>(() => {
    if (typeof window === "undefined") return false
    return window.localStorage.getItem(STORAGE_KEY) === "1"
  })

  React.useEffect(() => {
    if (typeof window === "undefined") return
    window.localStorage.setItem(STORAGE_KEY, open ? "1" : "0")
  }, [open])

  React.useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && (e.key === "M" || e.key === "m")) {
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [enabled])

  return [open, setOpen] as const
}

function fmtMs(ms: number | null | undefined): string {
  if (ms == null) return "-"
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

function fmtTps(v: number | null | undefined): string {
  if (v == null) return "-"
  return `${v.toFixed(1)} tok/s`
}

function StatusPill({ status }: { status: string | null }) {
  const tone =
    status === "completed"
      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
      : status === "error"
        ? "bg-red-500/15 text-red-700 dark:text-red-400"
        : status === "cancelled"
          ? "bg-muted text-muted-foreground"
          : status === "interrupted"
            ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
            : "bg-muted text-muted-foreground"
  return (
    <span className={cn("rounded px-1.5 py-0.5 text-[10px]", tone)}>
      {status ?? "-"}
    </span>
  )
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="border-t border-border/40 px-3 py-2 first:border-t-0">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      {children}
    </div>
  )
}

function InflightTable({ rows }: { rows: StreamMetricsInflight[] }) {
  if (rows.length === 0) {
    return (
      <div className="text-[11px] text-muted-foreground">无</div>
    )
  }
  return (
    <table className="w-full text-[11px] tabular-nums">
      <thead className="text-[10px] text-muted-foreground">
        <tr>
          <th className="text-left font-normal">conv</th>
          <th className="text-left font-normal">src</th>
          <th className="text-right font-normal">elapsed</th>
          <th className="text-right font-normal">ttft</th>
          <th className="text-right font-normal">tok</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.conversation_id}>
            <td>{r.conversation_id}</td>
            <td className="truncate">{r.source}</td>
            <td className="text-right">{fmtMs(r.elapsed_ms)}</td>
            <td
              className={cn(
                "text-right",
                r.ttft_ms == null && r.elapsed_ms > 2000
                  ? "text-amber-600 dark:text-amber-500"
                  : ""
              )}
            >
              {fmtMs(r.ttft_ms)}
            </td>
            <td className="text-right">{r.tokens}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function SummaryBlock({ summary }: { summary: StreamMetricsSummary }) {
  if (!summary || summary.count === 0) {
    return (
      <div className="text-[11px] text-muted-foreground">尚无样本</div>
    )
  }
  return (
    <div className="grid grid-cols-3 gap-x-2 gap-y-1 text-[11px] tabular-nums">
      <div className="col-span-3 text-[10px] text-muted-foreground">
        样本 {summary.count}
        {summary.non_completed ? ` · 异常 ${summary.non_completed}` : ""}
      </div>
      <div className="text-muted-foreground">TTFT</div>
      <div>p50 {fmtMs(summary.ttft_ms?.p50)}</div>
      <div>p95 {fmtMs(summary.ttft_ms?.p95)}</div>
      <div className="text-muted-foreground">总耗时</div>
      <div>p50 {fmtMs(summary.total_ms?.p50)}</div>
      <div>p95 {fmtMs(summary.total_ms?.p95)}</div>
      <div className="text-muted-foreground">吞吐</div>
      <div className="col-span-2">{fmtTps(summary.tps_avg)}</div>
    </div>
  )
}

function RecentList({ rows }: { rows: StreamMetricsRecent[] }) {
  if (rows.length === 0) {
    return (
      <div className="text-[11px] text-muted-foreground">尚无历史</div>
    )
  }
  return (
    <table className="w-full text-[11px] tabular-nums">
      <thead className="text-[10px] text-muted-foreground">
        <tr>
          <th className="text-left font-normal">conv</th>
          <th className="text-right font-normal">ttft</th>
          <th className="text-right font-normal">总</th>
          <th className="text-right font-normal">tok/s</th>
          <th className="text-right font-normal">状态</th>
        </tr>
      </thead>
      <tbody>
        {rows.slice(0, 8).map((r, i) => (
          <tr key={`${r.conversation_id}-${i}`}>
            <td>{r.conversation_id}</td>
            <td
              className={cn(
                "text-right",
                r.ttft_ms != null && r.ttft_ms > 2000
                  ? "text-amber-600 dark:text-amber-500"
                  : ""
              )}
            >
              {fmtMs(r.ttft_ms)}
            </td>
            <td className="text-right">{fmtMs(r.total_ms)}</td>
            <td className="text-right">
              {r.tps != null ? r.tps.toFixed(1) : "-"}
            </td>
            <td className="text-right">
              <StatusPill status={r.status} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function StreamMetricsOverlay() {
  const devMode = useDevMode()
  const [open, setOpen] = useOverlayToggle(devMode)
  const { data } = useQuery({
    queryKey: ["system", "runtime", "metrics-overlay"],
    queryFn: fetchRuntimeConfig,
    enabled: devMode && open,
    refetchInterval: devMode && open ? 1500 : false,
    staleTime: 0,
  })

  if (!devMode) return null

  if (!open) {
    return (
      <button
        type="button"
        title="打开流监控 (Ctrl+Shift+M)"
        onClick={() => setOpen(true)}
        className="fixed bottom-10 right-3 z-50 inline-flex h-7 w-7 items-center justify-center rounded-full border border-border/60 bg-background/80 text-muted-foreground shadow-sm backdrop-blur transition hover:text-foreground"
      >
        <IconActivity className="size-3.5" />
      </button>
    )
  }

  const agent = data?.data?.agent_runtime
  const metrics = agent?.metrics
  const active = agent?.active_streams ?? 0
  const queued = agent?.queued_starts ?? 0
  const serial = agent?.serial_mode ? "串行" : "并行"
  const maxC = agent?.max_concurrent_streams ?? 0

  return (
    <div className="fixed bottom-10 right-3 z-50 w-80 overflow-hidden rounded-md border border-border/60 bg-background/95 shadow-lg backdrop-blur">
      <div className="flex items-center justify-between border-b border-border/50 bg-muted/40 px-3 py-1.5">
        <div className="inline-flex items-center gap-1.5 text-[11px] font-medium">
          <IconActivity className="size-3.5" />
          流监控
          <span className="text-muted-foreground">
            · {serial}
            {maxC > 0 ? ` · cap ${maxC}` : ""}
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-5"
          onClick={() => setOpen(false)}
          title="关闭 (Ctrl+Shift+M)"
        >
          <IconX className="size-3" />
        </Button>
      </div>

      <Section title="并发">
        <div className="flex items-baseline gap-4 text-[11px] tabular-nums">
          <div>
            <span className="text-muted-foreground">运行 </span>
            <span className="font-semibold">{active}</span>
          </div>
          <div>
            <span className="text-muted-foreground">排队 </span>
            <span
              className={cn(
                "font-semibold",
                queued > 0 && "text-amber-600 dark:text-amber-500"
              )}
            >
              {queued}
            </span>
          </div>
        </div>
      </Section>

      <Section title="在飞流">
        <InflightTable rows={metrics?.inflight ?? []} />
      </Section>

      <Section title="近期统计">
        <SummaryBlock
          summary={metrics?.summary ?? { count: 0 }}
        />
      </Section>

      <Section title="历史">
        <RecentList rows={metrics?.recent ?? []} />
      </Section>
    </div>
  )
}
