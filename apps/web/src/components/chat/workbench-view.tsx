import * as React from "react"
import { IconPlus, IconX } from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import { Skeleton } from "@workspace/ui/components/skeleton"
import type { MetadataSkill } from "@/api/types"
import { useEmployeeDetailQuery } from "@/hooks/use-chat-queries"
import { useWorkbenchConfig } from "@/hooks/use-workbench-config"
import { fetchEmployeeSkillsFromLocal } from "@/lib/workbench/local-skill-loader"
import { WorkbenchLeftPanel } from "@/components/workbench/workbench-left-panel"
import { DraggableWorkbenchGrid } from "@/components/workbench/draggable-workbench-grid"
import { AddBlockDialog } from "@/components/workbench/add-block-dialog"

interface WorkbenchViewProps {
  contact: ChatViewContact
  onClose: () => void
}

export function WorkbenchView({ contact, onClose }: WorkbenchViewProps) {
  const [showAddDialog, setShowAddDialog] = React.useState(false)
  const [localSkills, setLocalSkills] = React.useState<MetadataSkill[]>([])
  const [isLoadingSkills, setIsLoadingSkills] = React.useState(false)

  const employeeId = contact.employee?.id ?? ""
  const employeeName = contact.employee?.name ?? ""

  // Get API skills
  const { data: employee } = useEmployeeDetailQuery(employeeId)
  const apiSkills = employee?.metadata?.skills ?? []

  // Load local skills based on employee name
  React.useEffect(() => {
    if (employeeName) {
      loadLocalSkills()
    }
  }, [employeeName])

  const loadLocalSkills = async () => {
    setIsLoadingSkills(true)
    try {
      const skills = await fetchEmployeeSkillsFromLocal(employeeId, employeeName)
      setLocalSkills(skills)
    } catch (e) {
      console.error("Failed to load local skills:", e)
      setLocalSkills([])
    } finally {
      setIsLoadingSkills(false)
    }
  }

  // Use API skills first (contains complete skillContent), fallback to local skills
  const skills = apiSkills.length > 0 ? apiSkills : localSkills

  const { config, toggleBlockEnabled, reorderBlocks, addBlock, removeBlock, resizeBlock } = useWorkbenchConfig({
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
            自定义模块 {isLoadingSkills && "(加载中...)"}
          </div>
          {isLoadingSkills ? (
            <div className="space-y-3">
              <Skeleton className="h-32 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          ) : config ? (
            <DraggableWorkbenchGrid
              blocks={config.blocks}
              onReorder={reorderBlocks}
              onToggleBlock={toggleBlockEnabled}
              onRemoveBlock={removeBlock}
              onResizeBlock={resizeBlock}
            />
          ) : null}
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
