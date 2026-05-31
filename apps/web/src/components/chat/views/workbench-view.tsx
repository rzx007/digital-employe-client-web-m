import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { IconPlus, IconX } from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { cn } from "@workspace/ui/lib/utils"
import type { MetadataSkill, SkillListItem } from "@/api/types"
import { fetchEmployees, fetchSkillList } from "@/api/employee"
import { useWorkbenchConfig } from "@/hooks/use-workbench-config"
import { fetchEmployeeSkillsFromLocal } from "@/lib/workbench/local-skill-loader"
import { isInstalledSource } from "@/components/skills/skill-utils"
import { useChatStore } from "@/stores/chat-store"
import { WorkbenchLeftPanel } from "@/components/workbench/workbench-left-panel"
import { DraggableWorkbenchGrid } from "@/components/workbench/draggable-workbench-grid"
import { AddBlockDialog } from "@/components/workbench/add-block-dialog"
import { WorkbenchContentSplit } from "@/components/workbench/workbench-content-split"

/** Single global workbench config key – see workbench-config.ts localStorage prefix */
const GLOBAL_WORKBENCH_ID = "global"

interface WorkbenchViewProps {
  onClose?: () => void
  className?: string
}

/** 工作台技能行：中文展示名 + 来源圆点（弹框用），解析仍用 skillName */
type WorkbenchSkillRow = MetadataSkill & {
  displayNameZh?: string | null
  workbenchSource?: "local" | "builtin"
  workbenchSkillLabel?: string
  workbenchRowKey?: string
}

function skillListItemToWorkbenchRow(
  item: SkillListItem,
  index: number
): WorkbenchSkillRow {
  const src = item.source ?? "local"
  const isBuiltin = src === "builtin"
  return {
    id: item.id,
    skillName: item.skillName,
    description: item.description ?? "",
    prompt: item.prompt ?? "",
    directoryId: item.directoryId,
    directoryName:
      item.directoryName ??
      (isBuiltin ? "内置技能" : "本地技能"),
    status: item.status ?? 1,
    createTime: item.createTime ?? "",
    updateTime: item.updateTime ?? "",
    skillContent: item.skillContent ?? "",
    displayNameZh: item.displayNameZh ?? null,
    workbenchSource: isBuiltin ? "builtin" : "local",
    workbenchRowKey: `ws-skill-list-${src}-${String(item.id)}-${item.skillName}-${index}`,
  }
}

export function WorkbenchView({ onClose, className }: WorkbenchViewProps) {
  const [showAddDialog, setShowAddDialog] = React.useState(false)
  const [localEnriched, setLocalEnriched] = React.useState<MetadataSkill[]>([])
  const [isLoadingLocalEnrich, setIsLoadingLocalEnrich] = React.useState(false)

  const contacts = useChatStore((s) => s.contacts)

  const { data: employeesFromApi = [] } = useQuery({
    queryKey: ["workbench", "employees"],
    queryFn: async ({ signal }) => {
      const res = await fetchEmployees({ signal })
      return res.data ?? []
    },
    staleTime: 30_000,
  })

  const { data: skillListItems = [], isLoading: isLoadingSkillList } = useQuery(
    {
      queryKey: ["workbench", "skill-list", "local-only"],
      queryFn: ({ signal }) => fetchSkillList({ signal, localOnly: true }),
      staleTime: 30_000,
    }
  )

  React.useEffect(() => {
    let cancelled = false
    const load = async () => {
      setIsLoadingLocalEnrich(true)
      try {
        const skills = await fetchEmployeeSkillsFromLocal(GLOBAL_WORKBENCH_ID)
        if (!cancelled) setLocalEnriched(skills)
      } catch (e) {
        console.error("Failed to load local skills for enrich:", e)
        if (!cancelled) setLocalEnriched([])
      } finally {
        if (!cancelled) setIsLoadingLocalEnrich(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  /**
   * 弹框与解析用技能源：仅本地 + 内置（不含远程平台技能）；
   * 本地行再合并 disk 上 SKILL.md 等以便接口解析。
   */
  const skills = React.useMemo(() => {
    const installed = skillListItems.filter(isInstalledSource)
    const byName = new Map(localEnriched.map((s) => [s.skillName, s] as const))
    return installed.map((item, idx) => {
      const base = skillListItemToWorkbenchRow(item, idx)
      if (item.source === "local") {
        const full = byName.get(item.skillName)
        if (full) {
          const sc =
            (full as MetadataSkill & { skill_content?: string })
              .skill_content ?? full.skillContent
          return {
            ...base,
            skillContent: sc ?? base.skillContent,
            prompt: full.prompt || base.prompt,
            description: full.description || base.description,
          }
        }
      }
      return base
    })
  }, [skillListItems, localEnriched])

  const ready = !isLoadingSkillList && !isLoadingLocalEnrich

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
        {onClose && (
          <Button variant="ghost" size="icon-sm" onClick={onClose}>
            <IconX className="size-4" />
          </Button>
        )}
      </div>

      <div className="flex min-h-0 flex-1">
        <WorkbenchLeftPanel />
        <WorkbenchContentSplit>
          {!ready ? (
            <div className="space-y-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="text-xs font-medium text-muted-foreground">
                  自定义模板 (加载中...)
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowAddDialog(true)}
                  className="shrink-0 gap-1"
                  disabled
                >
                  <IconPlus className="size-3.5" />
                  添加模块
                </Button>
              </div>
              <Skeleton className="h-32 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          ) : skills.length === 0 ? (
            <div className="space-y-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="text-xs font-medium text-muted-foreground">
                  自定义模板
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowAddDialog(true)}
                  className="shrink-0 gap-1"
                >
                  <IconPlus className="size-3.5" />
                  添加模块
                </Button>
              </div>
              <div className="flex min-h-[120px] items-center justify-center rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                暂无可选技能。请在「技能」页导入本地 ZIP，或使用内置技能
              </div>
            </div>
          ) : (
            <>
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="text-xs font-medium text-muted-foreground">
                  自定义模板
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowAddDialog(true)}
                  className="shrink-0 gap-1"
                >
                  <IconPlus className="size-3.5" />
                  添加模块
                </Button>
              </div>
              {config ? (
                <DraggableWorkbenchGrid
                  blocks={config.blocks}
                  onReorder={reorderBlocks}
                  onToggleBlock={toggleBlockEnabled}
                  onRemoveBlock={removeBlock}
                  onResizeBlock={resizeBlock}
                  onAddTemplate={() => setShowAddDialog(true)}
                />
              ) : null}
            </>
          )}
        </WorkbenchContentSplit>
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
