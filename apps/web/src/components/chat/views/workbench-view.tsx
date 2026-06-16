import {
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconX,
} from "@tabler/icons-react"
import { useLocalStorageState } from "ahooks"
import { Button } from "@workspace/ui/components/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"
import { useWorkbenchConfig } from "@/hooks/use-workbench-config"
import { GLOBAL_WORKBENCH_ID } from "@/lib/workbench/workbench-config"
import { WorkbenchLeftPanel } from "@/components/workbench/workbench-left-panel"
import { DraggableWorkbenchGrid } from "@/components/workbench/draggable-workbench-grid"
import { WorkbenchContentSplit } from "@/components/workbench/workbench-content-split"

const LEFT_PANEL_COLLAPSED_KEY = "workbench:left-panel:collapsed"

interface WorkbenchViewProps {
  onClose?: () => void
  className?: string
}

export function WorkbenchView({ onClose, className }: WorkbenchViewProps) {
  const { config, reorderBlocks, removeBlock, resizeBlock } = useWorkbenchConfig({
    employeeId: GLOBAL_WORKBENCH_ID,
  })

  const [leftCollapsed = false, setLeftCollapsed] =
    useLocalStorageState<boolean>(LEFT_PANEL_COLLAPSED_KEY, {
      defaultValue: false,
    })

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
      <div className="flex items-center justify-between border-b px-4 py-2">
        <div className="flex items-center gap-2">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="-ml-1 text-muted-foreground hover:text-foreground"
                  aria-label={leftCollapsed ? "展开左栏" : "收起左栏"}
                  onClick={() => setLeftCollapsed(!leftCollapsed)}
                >
                  {leftCollapsed ? (
                    <IconLayoutSidebarLeftExpand className="size-4" />
                  ) : (
                    <IconLayoutSidebarLeftCollapse className="size-4" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {leftCollapsed ? "展开左栏" : "收起左栏"}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <h3 className="text-sm font-medium">工作台</h3>
        </div>
        {onClose && (
          <Button variant="ghost" size="icon-sm" onClick={onClose}>
            <IconX className="size-4" />
          </Button>
        )}
      </div>

      <div className="flex min-h-0 flex-1">
        {!leftCollapsed && <WorkbenchLeftPanel />}
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
