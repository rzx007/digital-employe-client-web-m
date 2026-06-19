import { useEffect, useRef } from "react"
import { IconLayoutGrid } from "@tabler/icons-react"
import { cn } from "@workspace/ui/lib/utils"
import type { WorkbenchArrangeOp } from "@/types/workbench"
import {
  GLOBAL_WORKBENCH_ID,
  applyArrangeOperations,
  emitWorkbenchConfigChanged,
  initializeWorkbenchConfig,
  loadWorkbenchConfig,
} from "@/lib/workbench/workbench-config"

/** 已应用过的 key 集合（模块级，防 React 重渲染/重挂载重复应用）。 */
const appliedKeys = new Set<string>()

export function WorkbenchArrangeCard({
  blockKey,
  operations,
  summary,
  conversationId,
  className,
}: {
  blockKey: string
  operations: WorkbenchArrangeOp[]
  summary: string
  conversationId?: string | number | null
  className?: string
}) {
  const didApply = useRef(false)

  useEffect(() => {
    if (didApply.current || appliedKeys.has(blockKey)) return
    if (conversationId == null) return
    didApply.current = true
    appliedKeys.add(blockKey)
    const cfg =
      loadWorkbenchConfig(GLOBAL_WORKBENCH_ID) ??
      initializeWorkbenchConfig(GLOBAL_WORKBENCH_ID)
    applyArrangeOperations(cfg, operations, conversationId)
    emitWorkbenchConfigChanged()
  }, [blockKey, operations, conversationId])

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs",
        className
      )}
    >
      <IconLayoutGrid className="size-4 text-primary" />
      <span className="text-muted-foreground">{summary}</span>
    </div>
  )
}
