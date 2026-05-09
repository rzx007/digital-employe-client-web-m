import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { IconPlus, IconX } from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { cn } from "@workspace/ui/lib/utils"
import type { Employee, MetadataSkill } from "@/api/types"
import { fetchEmployees } from "@/api/employee"
import { useWorkbenchConfig } from "@/hooks/use-workbench-config"
import { fetchEmployeeSkillsFromLocal } from "@/lib/workbench/local-skill-loader"
import { useChatStore } from "@/stores/chat-store"
import { WorkbenchLeftPanel } from "@/components/workbench/workbench-left-panel"
import { DraggableWorkbenchGrid } from "@/components/workbench/draggable-workbench-grid"
import { AddBlockDialog } from "@/components/workbench/add-block-dialog"
import { CuratorView } from "@/components/chat/curator-view"

/** Single global workbench config key – see workbench-config.ts localStorage prefix */
const GLOBAL_WORKBENCH_ID = "global"

interface WorkbenchViewProps {
  onClose?: () => void
  className?: string
}

/** UI label + stable row key; extends MetadataSkill for workbench only */
type WorkbenchSkillRow = MetadataSkill & {
  workbenchSkillLabel?: string
  workbenchRowKey?: string
}

function skillsFromEmployeeList(employees: Employee[]): WorkbenchSkillRow[] {
  const list: WorkbenchSkillRow[] = []
  for (const emp of employees) {
    const snap = emp.metadata?.skills
    if (!snap?.length) continue
    snap.forEach((skill, idx) => {
      list.push({
        ...skill,
        directoryName: skill.directoryName ?? "远程技能",
        workbenchSkillLabel: `${skill.skillName} · 远程技能`,
        /** Disambiguate bindings that share the same skill id */
        workbenchRowKey: `${emp.id}-${String(skill.id ?? skill.skillName)}-${idx}`,
      })
    })
  }
  return list
}

export function WorkbenchView({ onClose, className }: WorkbenchViewProps) {
  const [showAddDialog, setShowAddDialog] = React.useState(false)
  const [localSkills, setLocalSkills] = React.useState<MetadataSkill[]>([])
  const [isLoadingSkills, setIsLoadingSkills] = React.useState(false)

  const contacts = useChatStore((s) => s.contacts)

  const { data: employeesFromApi = [] } = useQuery({
    queryKey: ["workbench", "employees"],
    queryFn: async ({ signal }) => {
      const res = await fetchEmployees({ signal })
      return res.data ?? []
    },
    staleTime: 30_000,
  })

  const apiSkillsFromEmployees = React.useMemo(
    () => skillsFromEmployeeList(employeesFromApi),
    [employeesFromApi]
  )

  const apiSkillsFromContacts = React.useMemo(() => {
    const list: WorkbenchSkillRow[] = []
    for (const c of contacts) {
      if (c.type !== "employee" || !c.employee?.skills?.length) continue
      c.employee.skills.forEach((skill, idx) => {
        list.push({
          ...skill,
          directoryName: skill.directoryName || "远程技能",
          workbenchSkillLabel: `${skill.skillName} · 远程技能`,
          workbenchRowKey: `${c.employee!.id}-${String(skill.id ?? skill.skillName)}-${idx}`,
        })
      })
    }
    return list
  }, [contacts])

  /** 合并接口与通讯录中的远程技能（按 workbenchRowKey 去重，避免只显示其中一路） */
  const apiSkills = React.useMemo(() => {
    const map = new Map<string, WorkbenchSkillRow>()
    const put = (row: WorkbenchSkillRow) => {
      const k =
        row.workbenchRowKey ??
        `${row.skillName}-${String(row.id ?? "")}-${row.directoryName ?? ""}`
      if (!map.has(k)) map.set(k, row)
    }
    for (const row of apiSkillsFromEmployees) put(row)
    for (const row of apiSkillsFromContacts) put(row)
    return [...map.values()]
  }, [apiSkillsFromEmployees, apiSkillsFromContacts])

  React.useEffect(() => {
    let cancelled = false
    const load = async () => {
      setIsLoadingSkills(true)
      try {
        const skills = await fetchEmployeeSkillsFromLocal(GLOBAL_WORKBENCH_ID)
        if (!cancelled) setLocalSkills(skills)
      } catch (e) {
        console.error("Failed to load local skills:", e)
        if (!cancelled) setLocalSkills([])
      } finally {
        if (!cancelled) setIsLoadingSkills(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const skills = React.useMemo(() => {
    const remote = apiSkills
    const localRows: WorkbenchSkillRow[] = localSkills.map((skill, idx) => ({
      ...skill,
      directoryName: skill.directoryName || "本地技能",
      workbenchSkillLabel: `${skill.skillName} · 本地技能`,
      workbenchRowKey: `local-${skill.skillName}-${idx}`,
    }))
    return [...remote, ...localRows]
  }, [apiSkills, localSkills])

  const ready = !isLoadingSkills

  const {
    config,
    toggleBlockEnabled,
    reorderBlocks,
    addBlock,
    removeBlock,
    resizeBlock,
  } = useWorkbenchConfig({
    employeeId: ready ? GLOBAL_WORKBENCH_ID : null,
    skills: ready ? skills : [],
  })

  const handleAddInterfaces = (
    interfaces: import("@/types/workbench").QueryInterface[]
  ) => {
    interfaces.forEach((iface) => {
      addBlock(iface)
    })
  }

  /** 后端 /chat/send 需要整数 employee_id；取工作空间内第一位员工作为解析/补全用身份 */
  const chatEmployeeId = React.useMemo(() => {
    const fromApi = employeesFromApi[0]?.id
    if (fromApi != null && fromApi > 0) return fromApi
    const first = contacts.find((c) => c.type === "employee" && c.employee)
    if (first?.type === "employee" && first.employee?.id) {
      const n = Number(first.employee.id)
      if (Number.isFinite(n) && n > 0) return n
    }
    return undefined
  }, [employeesFromApi, contacts])

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
      <div className="flex items-center justify-between border-b px-4 py-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium">工作台</h3>
        </div>
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
          {onClose && (
            <Button variant="ghost" size="icon-sm" onClick={onClose}>
              <IconX className="size-4" />
            </Button>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1">
          <WorkbenchLeftPanel />
          <div className="min-w-0 flex-1 overflow-auto p-3">
            {!ready ? (
              <div className="space-y-3">
                <div className="mb-2 text-xs font-medium text-muted-foreground">
                  自定义模块 (加载中...)
                </div>
                <Skeleton className="h-32 w-full" />
                <Skeleton className="h-32 w-full" />
              </div>
            ) : skills.length === 0 ? (
              <div className="flex min-h-[120px] items-center justify-center rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                暂无可用技能，请先在「技能」中导入或为员工绑定技能
              </div>
            ) : (
              <>
                <div className="mb-2 text-xs font-medium text-muted-foreground">
                  自定义模块
                </div>
                {config ? (
                  <DraggableWorkbenchGrid
                    blocks={config.blocks}
                    onReorder={reorderBlocks}
                    onToggleBlock={toggleBlockEnabled}
                    onRemoveBlock={removeBlock}
                    onResizeBlock={resizeBlock}
                  />
                ) : null}
              </>
            )}
          </div>
        </div>

        <CuratorView
          size="compact"
          className="w-[400px] shrink-0 border-l px-1"
        />
      </div>

      <AddBlockDialog
        open={showAddDialog}
        onOpenChange={setShowAddDialog}
        skills={skills}
        employeeId={GLOBAL_WORKBENCH_ID}
        chatEmployeeId={chatEmployeeId}
        onAdd={handleAddInterfaces}
      />
    </div>
  )
}
