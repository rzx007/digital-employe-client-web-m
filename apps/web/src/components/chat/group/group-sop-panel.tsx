import * as React from "react"

import { cn } from "@workspace/ui/lib/utils"

import { createDiceBearAvatar, CURATOR_AVATAR_URL } from "@/lib/avatar"
import { navigateToEmployeeFromGroup } from "@/lib/chat/group-navigation"
import { switchToContact } from "@/lib/chat/conversation-selection"
import type {
  DagNode,
  DagNodeState,
  DagNodeType,
  GroupRoomDag,
} from "@/api/group-room"

import { useArtifactStore } from "@/stores/artifact-store"

/** 节点状态 → 颜色/文案 */
const STATE_META: Record<
  DagNodeState,
  { label: string; dot: string; text: string; card: string }
> = {
  pending: {
    label: "待命",
    dot: "bg-muted-foreground/30",
    text: "text-muted-foreground",
    card: "border-border/70 bg-muted/30",
  },
  running: {
    label: "进行中",
    dot: "bg-blue-500",
    text: "text-blue-600",
    card: "border-blue-300 bg-blue-50/60 ring-1 ring-blue-200/60",
  },
  done: {
    label: "已交付",
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

const TYPE_ICON: Record<
  DagNodeType,
  { glyph: string; ring: string }
> = {
  user: { glyph: "你", ring: "bg-slate-100 text-slate-600 ring-slate-200" },
  leader: { glyph: "组", ring: "bg-amber-100 text-amber-700 ring-amber-200" },
  worker: { glyph: "", ring: "bg-blue-100 text-blue-700 ring-blue-200" },
}

function fileName(path: string): string {
  const parts = path.split(/[/\\]/)
  return parts[parts.length - 1] || path
}

function initialOf(name: string): string {
  const t = (name || "").trim()
  return t ? t.slice(0, 1) : "员"
}

/** 计算每个节点的层级（拓扑深度），用于竖向分层布局 */
function computeLevels(dag: GroupRoomDag): Map<string, number> {
  const incoming = new Map<string, string[]>()
  const outgoing = new Map<string, string[]>()
  dag.nodes.forEach((n) => {
    incoming.set(n.id, [])
    outgoing.set(n.id, [])
  })
  dag.edges.forEach((e) => {
    outgoing.get(e.from)?.push(e.to)
    incoming.get(e.to)?.push(e.from)
  })

  const level = new Map<string, number>()
  const queue: string[] = []
  dag.nodes.forEach((n) => {
    if ((incoming.get(n.id) ?? []).length === 0) {
      level.set(n.id, 0)
      queue.push(n.id)
    }
  })
  let guard = 0
  while (queue.length && guard < 10000) {
    guard++
    const cur = queue.shift()!
    const curLevel = level.get(cur) ?? 0
    for (const next of outgoing.get(cur) ?? []) {
      const cand = curLevel + 1
      if (cand > (level.get(next) ?? -1)) {
        level.set(next, cand)
        queue.push(next)
      }
    }
  }
  dag.nodes.forEach((n) => {
    if (!level.has(n.id)) level.set(n.id, 0)
  })
  return level
}

/** 节点头像 URL：成员用 DiceBear(员工id)，组长用总管头像，用户用占位 */
function avatarUrlOf(node: DagNode): string | null {
  if (node.type === "leader") return CURATOR_AVATAR_URL
  if (node.type === "worker" && node.employee_id != null) {
    return createDiceBearAvatar(String(node.employee_id))
  }
  return null
}

function NodeAvatar({ node }: { node: DagNode }) {
  const t = TYPE_ICON[node.type]
  const meta = STATE_META[node.state] ?? STATE_META.pending
  const url = avatarUrlOf(node)
  return (
    <div className="relative shrink-0">
      {url ? (
        <img
          src={url}
          alt={node.name}
          className="size-8 rounded-full object-cover ring-2 ring-background"
        />
      ) : (
        <div
          className={cn(
            "flex size-8 items-center justify-center rounded-full text-xs font-semibold ring-2",
            t.ring
          )}
        >
          {node.type === "worker" ? initialOf(node.name) : t.glyph}
        </div>
      )}
      <span
        className={cn(
          "absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-background",
          meta.dot,
          node.state === "running" && "animate-pulse"
        )}
      />
    </div>
  )
}

function NodeCardBody({
  node,
  onOpenArtifact,
  onOpenMember,
}: {
  node: DagNode
  onOpenArtifact?: (path: string) => void
  onOpenMember?: (node: DagNode) => void
}) {
  const meta = STATE_META[node.state] ?? STATE_META.pending
  const canJump =
    node.type === "worker" &&
    node.employee_id != null &&
    node.conversation_id != null
  const canOpenEmployee =
    node.type === "worker" && node.employee_id != null
  return (
    <>
      <div
        className={cn(
          "min-w-0 flex-1 rounded-xl border px-3 py-2 transition-colors",
          meta.card,
          canOpenEmployee && "cursor-pointer hover:border-primary/50 hover:shadow-sm"
        )}
        onClick={
          canOpenEmployee
            ? () => onOpenMember?.(node)
            : undefined
        }
        title={
          canJump
            ? `查看 ${node.name} 的执行会话`
            : canOpenEmployee
              ? `${node.name}（暂无执行会话，将打开员工聊天）`
              : undefined
        }
      >
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">
            {node.name}
          </span>
          <span
            className={cn(
              "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
              meta.text,
              "bg-background/70"
            )}
          >
            {meta.label}
          </span>
        </div>
        {node.task ? (
          <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-relaxed text-muted-foreground">
            {node.task}
          </p>
        ) : null}
        {canJump && node.state === "running" ? (
          <p className="mt-1 text-[10.5px] font-medium text-blue-600">
            点击查看执行中会话 →
          </p>
        ) : null}
        {node.artifacts.length > 0 ? (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {node.artifacts.map((a) => (
              <button
                key={a}
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onOpenArtifact?.(a)
                }}
                className="inline-flex max-w-full items-center gap-1 truncate rounded-md border border-border/60 bg-background px-1.5 py-0.5 text-[11px] text-foreground/80 transition-colors hover:border-primary/40 hover:text-foreground"
                title={fileName(a)}
              >
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 16 16"
                  fill="none"
                  className="shrink-0 text-muted-foreground"
                >
                  <path
                    d="M9 1.5H4A1.5 1.5 0 0 0 2.5 3v10A1.5 1.5 0 0 0 4 14.5h8a1.5 1.5 0 0 0 1.5-1.5V6L9 1.5Z"
                    stroke="currentColor"
                    strokeWidth="1.2"
                    strokeLinejoin="round"
                  />
                  <path d="M9 1.5V6h4.5" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
                </svg>
                <span className="truncate">{fileName(a)}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </>
  )
}

/**
 * 群协作 SOP 面板：把组长统筹的编排计划画成竖向流程图（带连接脊线）。
 * 用户 → 组长 → 各成员任务（按依赖分层、并行同层）→ 组长汇总。
 * 每个节点显示头像、负责人、任务、状态、产物（可点开）。
 */
export function GroupSopPanel({
  dag,
  conversationId,
  groupContactId,
  memberConversationByEmployeeId,
  className,
}: {
  dag: GroupRoomDag
  conversationId: string | number
  groupContactId: string
  /** @直接派活时成员表上的 conversation_id，DAG 节点缺省时兜底 */
  memberConversationByEmployeeId?: Map<number, number>
  className?: string
}) {
  const openResource = useArtifactStore((s) => s.openResource)
  const onOpenMember = React.useCallback(
    (node: DagNode) => {
      if (node.type !== "worker" || node.employee_id == null) return
      const convId =
        node.conversation_id ??
        memberConversationByEmployeeId?.get(node.employee_id)
      if (convId != null) {
        navigateToEmployeeFromGroup({
          groupContactId,
          groupConversationId: conversationId,
          employeeId: node.employee_id,
          employeeConversationId: convId,
        })
        return
      }
      switchToContact(`employee:${node.employee_id}`)
    },
    [conversationId, groupContactId, memberConversationByEmployeeId]
  )
  const onOpenArtifact = React.useCallback(
    (p: string) => {
      // 复用资源管理器面板（专业渲染器 + 预览/源码切换，形式统一）。
      // 后端 ResourceService 已能把群会话解析到房间共享目录。
      openResource(p)
    },
    [openResource]
  )

  const levels = React.useMemo(() => computeLevels(dag), [dag])

  const rows = React.useMemo(() => {
    const byLevel = new Map<number, DagNode[]>()
    dag.nodes.forEach((n) => {
      const lv = levels.get(n.id) ?? 0
      if (!byLevel.has(lv)) byLevel.set(lv, [])
      byLevel.get(lv)!.push(n)
    })
    return [...byLevel.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, ns]) => ns)
  }, [dag, levels])

  const doneCount = dag.nodes.filter(
    (n) => n.type === "worker" && n.state === "done"
  ).length
  const runningCount = dag.nodes.filter((n) => n.state === "running").length
  const totalWorkers = dag.nodes.filter((n) => n.type === "worker").length
  const pct = totalWorkers ? Math.round((doneCount / totalWorkers) * 100) : 0

  return (
    <div className={cn("flex h-full flex-col", className)}>
      <div className="border-b px-4 py-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold">协作流程</span>
          <span className="text-xs tabular-nums text-muted-foreground">
            {doneCount}/{totalWorkers} 已交付
            {runningCount > 0 ? ` · ${runningCount} 进行中` : ""}
          </span>
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-emerald-500 transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="flex flex-col">
          {rows.map((row, ri) => {
            const isParallel = row.length > 1
            const isLastRow = ri === rows.length - 1
            return (
              <div key={ri} className="flex flex-col">
                {isParallel ? (
                  <div className="mb-1 ml-[15px] flex items-center gap-1.5 text-[10.5px] font-medium text-blue-500/80">
                    <span className="inline-block h-px w-3 bg-blue-300" />
                    并行执行
                  </div>
                ) : null}
                {row.map((node, ni) => {
                  const isLastInRow = ni === row.length - 1
                  // 时间轴脊线：除整图最后一个节点外都向下延伸
                  const showSpine = !(isLastRow && isLastInRow)
                  return (
                    <div key={node.id} className="relative flex gap-3 pb-3">
                      {/* 脊线（穿过头像中心） */}
                      {showSpine ? (
                        <span
                          className={cn(
                            "absolute left-[15px] top-9 bottom-0 w-0.5",
                            node.state === "done"
                              ? "bg-emerald-300"
                              : "bg-border"
                          )}
                          aria-hidden
                        />
                      ) : null}
                      <div className="z-10">
                        <NodeAvatar node={node} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <NodeCardBody
                          node={node}
                          onOpenArtifact={onOpenArtifact}
                          onOpenMember={onOpenMember}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>

      <div className="border-t px-4 py-2 text-[11px] leading-relaxed text-muted-foreground">
        成员共享产物，下游可读取上游产出；全部完成后组长汇总。
      </div>
    </div>
  )
}
