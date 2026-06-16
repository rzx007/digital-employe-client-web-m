import { IconX } from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { useWorkbenchConfig } from "@/hooks/use-workbench-config"
import { WorkbenchLeftPanel } from "@/components/workbench/workbench-left-panel"
import { DraggableWorkbenchGrid } from "@/components/workbench/draggable-workbench-grid"
import { WorkbenchContentSplit } from "@/components/workbench/workbench-content-split"

/** 单一全局工作台配置键 —— 见 workbench-config.ts localStorage 前缀 */
const GLOBAL_WORKBENCH_ID = "global"

interface WorkbenchViewProps {
  onClose?: () => void
  className?: string
}

export function WorkbenchView({ onClose, className }: WorkbenchViewProps) {
  const { config, reorderBlocks, removeBlock, resizeBlock } = useWorkbenchConfig({
    employeeId: GLOBAL_WORKBENCH_ID,
  })

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
      <div className="flex items-center justify-between border-b px-4 py-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium">工作台</h3>
        </div>
        {onClose && (
          <Button variant="ghost" size="icon-sm" onClick={onClose}>
            <IconX className="size-4" />
          </Button>
        )}
      </div>

      <div className="flex min-h-0 flex-1">
        <WorkbenchLeftPanel />
        <WorkbenchContentSplit>
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="text-xs font-medium text-muted-foreground">我的看板</div>
          </div>
          {config ? (
            <DraggableWorkbenchGrid
              blocks={config.blocks}
              onReorder={reorderBlocks}
              onRemoveBlock={removeBlock}
              onResizeBlock={resizeBlock}
            />
          ) : null}
        </WorkbenchContentSplit>
      </div>
    </div>
  )
}
