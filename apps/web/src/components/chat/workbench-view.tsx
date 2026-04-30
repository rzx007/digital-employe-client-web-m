import * as React from "react"
import { IconPlus, IconX } from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import { Skeleton } from "@workspace/ui/components/skeleton"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@workspace/ui/components/avatar"
import { cn } from "@workspace/ui/lib/utils"
import type { MetadataSkill } from "@/api/types"
import { useEmployeeDetailQuery } from "@/hooks/use-chat-queries"
import { useWorkbenchConfig } from "@/hooks/use-workbench-config"
import { fetchEmployeeSkillsFromLocal } from "@/lib/workbench/local-skill-loader"
import { useChatStore } from "@/stores/chat-store"
import { WorkbenchLeftPanel } from "@/components/workbench/workbench-left-panel"
import { DraggableWorkbenchGrid } from "@/components/workbench/draggable-workbench-grid"
import { AddBlockDialog } from "@/components/workbench/add-block-dialog"
import { CuratorView } from "@/components/chat/curator-view"
import type { ChatViewContact } from "./chat-view-shared"

interface WorkbenchViewProps {
  contact?: ChatViewContact
  onClose?: () => void
  className?: string
}

export function WorkbenchView({
  contact,
  onClose,
  className,
}: WorkbenchViewProps) {
  const [showAddDialog, setShowAddDialog] = React.useState(false)
  const [localSkills, setLocalSkills] = React.useState<MetadataSkill[]>([])
  const [isLoadingSkills, setIsLoadingSkills] = React.useState(false)

  const contacts = useChatStore((s) => s.contacts)
  const workbenchEmployeeId = useChatStore((s) => s.workbenchEmployeeId)
  const setWorkbenchEmployeeId = useChatStore(
    (s) => s.setWorkbenchEmployeeId
  )

  const employeeContacts = React.useMemo(
    () => contacts.filter((c) => c.type === "employee" && c.employee),
    [contacts]
  )

  const isTabMode = !contact

  const tabSelectedEmployee = React.useMemo(() => {
    if (!isTabMode) return undefined
    if (workbenchEmployeeId) {
      const found = employeeContacts.find(
        (c) => c.employee?.id === workbenchEmployeeId
      )
      if (found) return found.employee
    }
    return employeeContacts[0]?.employee
  }, [employeeContacts, isTabMode, workbenchEmployeeId])

  React.useEffect(() => {
    if (!isTabMode) return
    if (!tabSelectedEmployee) return
    if (workbenchEmployeeId !== tabSelectedEmployee.id) {
      setWorkbenchEmployeeId(tabSelectedEmployee.id)
    }
  }, [isTabMode, tabSelectedEmployee, workbenchEmployeeId, setWorkbenchEmployeeId])

  const employeeId =
    contact?.employee?.id ?? tabSelectedEmployee?.id ?? ""
  const employeeName =
    contact?.employee?.name ?? tabSelectedEmployee?.name ?? ""

  const { data: employee } = useEmployeeDetailQuery(employeeId)
  const apiSkills = employee?.metadata?.skills ?? []

  React.useEffect(() => {
    if (employeeName) {
      loadLocalSkills()
    } else {
      setLocalSkills([])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeName, employeeId])

  const loadLocalSkills = async () => {
    setIsLoadingSkills(true)
    try {
      const skills = await fetchEmployeeSkillsFromLocal(
        employeeId,
        employeeName
      )
      setLocalSkills(skills)
    } catch (e) {
      console.error("Failed to load local skills:", e)
      setLocalSkills([])
    } finally {
      setIsLoadingSkills(false)
    }
  }

  // 合并远程和本地技能，两者都保留
  const skills = React.useMemo(() => {
    const allSkills: MetadataSkill[] = []
    
    // 添加远程技能
    apiSkills.forEach((skill) => {
      allSkills.push({
        ...skill,
        directoryName: skill.directoryName || "远程技能",
      })
    })
    
    // 添加本地技能
    localSkills.forEach((skill) => {
      allSkills.push({
        ...skill,
        directoryName: skill.directoryName || "本地技能",
      })
    })

    console.log('[workbench-view] merged skills:', allSkills.map(s => ({
      skillName: s.skillName,
      directoryName: s.directoryName,
      hasSkillContent: !!(s.skillContent || s.skill_content),
      contentLength: (s.skillContent || s.skill_content || '').length,
    })))

    return allSkills
  }, [apiSkills, localSkills])

  const {
    config,
    toggleBlockEnabled,
    reorderBlocks,
    addBlock,
    removeBlock,
    resizeBlock,
  } = useWorkbenchConfig({
    employeeId,
    skills,
  })

  const handleAddInterfaces = (
    interfaces: import("@/types/workbench").QueryInterface[]
  ) => {
    interfaces.forEach((iface) => {
      addBlock(iface)
    })
  }

  const selectorValue = employeeId || undefined

  const renderEmployeeOption = (
    e: NonNullable<ChatViewContact["employee"]>
  ) => (
    <div className="flex items-center gap-2">
      <Avatar className="size-5">
        <AvatarImage src={e.avatar} alt={e.name} />
        <AvatarFallback>{e.name.slice(0, 1)}</AvatarFallback>
      </Avatar>
      <span className="text-sm">{e.name}</span>
      {e.role && (
        <span className="text-xs text-muted-foreground">{e.role}</span>
      )}
    </div>
  )

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
      {/* Workbench Header */}
      <div className="flex items-center justify-between border-b px-4 py-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium">工作台</h3>
          {isTabMode ? (
            <Select
              value={selectorValue}
              onValueChange={(v) => setWorkbenchEmployeeId(v)}
              disabled={employeeContacts.length === 0}
            >
              <SelectTrigger className="h-8 w-[240px]">
                <SelectValue placeholder="选择数字员工" />
              </SelectTrigger>
              <SelectContent>
                {employeeContacts.map((c) =>
                  c.employee ? (
                    <SelectItem key={c.employee.id} value={c.employee.id}>
                      {renderEmployeeOption(c.employee)}
                    </SelectItem>
                  ) : null
                )}
              </SelectContent>
            </Select>
          ) : (
            employeeName && (
              <span className="text-xs text-muted-foreground">
                {employeeName}
              </span>
            )
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowAddDialog(true)}
            className="gap-1"
            disabled={!employeeId}
          >
            <IconPlus className="size-3.5" />
            添加模块
          </Button>
          {onClose && (
            <Button variant="ghost" size="icon-sm" onClick={onClose}>
              <IconX className="size-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Workbench Content */}
      <div className="flex min-h-0 flex-1">
        {!employeeId ? (
          <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
            {employeeContacts.length === 0
              ? "暂无数字员工，请先在通讯录中添加"
              : "请选择一个数字员工"}
          </div>
        ) : (
          <div className="flex min-w-0 flex-1">
            <WorkbenchLeftPanel employeeId={employeeId} />
            <div className="min-w-0 flex-1 overflow-auto p-3">
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
        )}

        {isTabMode && <CuratorView size="compact" className="w-[400px] shrink-0 border-l px-1" />}
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
