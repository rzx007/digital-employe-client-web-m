import { IconX } from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { useWorkbenchConfig } from "@/hooks/use-workbench-config"
import { WorkbenchLeftPanel } from "@/components/workbench/workbench-left-panel"
import { WorkbenchTabs } from "@/components/workbench/workbench-tabs"
import { WorkbenchContentSplit } from "@/components/workbench/workbench-content-split"

interface WorkbenchViewProps {
  onClose?: () => void
  className?: string
}

export function WorkbenchView({ onClose, className }: WorkbenchViewProps) {
  const { config, isLoading, mutate } = useWorkbenchConfig()

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
          {isLoading || !config ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              加载中…
            </div>
          ) : (
            <WorkbenchTabs config={config} onChange={mutate} />
          )}
        </WorkbenchContentSplit>
      </div>
    </div>
  )
}
