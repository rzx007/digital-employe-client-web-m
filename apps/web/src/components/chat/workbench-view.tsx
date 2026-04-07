import * as React from "react"
import { IconPlus, IconX } from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import type { ChatViewContact } from "./chat-view-shared"
import { useEmployeeDetailQuery } from "@/hooks/use-chat-queries"
import { useWorkbenchConfig } from "@/hooks/use-workbench-config"
import { WorkbenchLeftPanel } from "@/components/workbench/workbench-left-panel"
import { DraggableWorkbenchGrid } from "@/components/workbench/draggable-workbench-grid"
import { AddBlockDialog } from "@/components/workbench/add-block-dialog"

interface WorkbenchViewProps {
  contact: ChatViewContact
  onClose: () => void
}

export function WorkbenchView({ contact, onClose }: WorkbenchViewProps) {
  const [showAddDialog, setShowAddDialog] = React.useState(false)

  const employeeId = contact.employee?.id ?? ""
  const { data: employee } = useEmployeeDetailQuery(employeeId)
  const skills = employee?.metadata?.skills ?? []

  const { config, toggleBlockEnabled, reorderBlocks, addBlock, removeBlock } = useWorkbenchConfig({
    employeeId,
    skills,
  })

  const handleAddInterfaces = (interfaces: import("@/types/workbench").QueryInterface[]) => {
    interfaces.forEach((iface) => {
      addBlock(iface)
    })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Workbench Header */}
      <div className="flex items-center justify-between border-b px-4 py-2">
        <h3 className="text-sm font-medium">工作台</h3>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowAddDialog(true)}
            className="gap-1"
          >
            <IconPlus className="size-3.5" />
            添加模块
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={onClose}>
            <IconX className="size-4" />
          </Button>
        </div>
      </div>

      {/* Workbench Content */}
      <div className="flex min-h-0 flex-1">
        <WorkbenchLeftPanel employeeId={employeeId} />
        <div className="flex-1 overflow-auto p-3">
          <div className="mb-2 text-xs font-medium text-muted-foreground">
            技能板块
          </div>
          {config && (
            <DraggableWorkbenchGrid
              blocks={config.blocks}
              onReorder={reorderBlocks}
              onToggleBlock={toggleBlockEnabled}
              onRemoveBlock={removeBlock}
            />
          )}
        </div>
      </div>

      {/* Add Block Dialog */}
      <AddBlockDialog
        open={showAddDialog}
        onOpenChange={setShowAddDialog}
        skills={skills}
        employeeId={employeeId}
        onAdd={handleAddInterfaces}
      />
    </div>
  )
}
