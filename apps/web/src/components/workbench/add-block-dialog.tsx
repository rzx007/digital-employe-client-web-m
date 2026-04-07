import * as React from "react"
import { IconPlus } from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { Checkbox } from "@workspace/ui/components/checkbox"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { Skeleton } from "@workspace/ui/components/skeleton"
import type { MetadataSkill } from "@/api/types"
import type { QueryInterface } from "@/types/workbench"
import { parseInterfacesFromSkills } from "@/lib/workbench/query-interface-parser"

interface AddBlockDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  skills: MetadataSkill[]
  employeeId: string
  onAdd: (interfaces: QueryInterface[]) => void
}

export function AddBlockDialog({
  open,
  onOpenChange,
  skills,
  employeeId,
  onAdd,
}: AddBlockDialogProps) {
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set())
  const [interfaces, setInterfaces] = React.useState<QueryInterface[]>([])
  const [isLoading, setIsLoading] = React.useState(false)
  const [hasLoaded, setHasLoaded] = React.useState(false)

  // Load interfaces when dialog opens
  React.useEffect(() => {
    if (open && !hasLoaded) {
      loadInterfaces()
    }
  }, [open, hasLoaded])

  const loadInterfaces = async () => {
    setIsLoading(true)
    try {
      const parsed = await parseInterfacesFromSkills(employeeId, skills)
      setInterfaces(parsed)
      setHasLoaded(true)
    } catch (e) {
      console.error("Failed to load interfaces:", e)
    } finally {
      setIsLoading(false)
    }
  }

  const handleToggle = (id: string) => {
    const newSelected = new Set(selectedIds)
    if (newSelected.has(id)) {
      newSelected.delete(id)
    } else {
      newSelected.add(id)
    }
    setSelectedIds(newSelected)
  }

  const handleAdd = () => {
    const selected = interfaces.filter((i) => selectedIds.has(i.id))
    onAdd(selected)
    setSelectedIds(new Set())
    setInterfaces([])
    setHasLoaded(false)
    onOpenChange(false)
  }

  const handleClose = () => {
    setSelectedIds(new Set())
    setInterfaces([])
    setHasLoaded(false)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>添加数据模块</DialogTitle>
          <DialogDescription>
            选择要添加到工作台的查询接口模块
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : interfaces.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              未从技能中发现查询接口
            </div>
          ) : (
            <ScrollArea className="max-h-[300px]">
              <div className="space-y-2">
                {interfaces.map((iface) => (
                  <div
                    key={iface.id}
                    className="flex items-start gap-3 rounded-md border p-3 transition-colors hover:bg-accent/50"
                  >
                    <Checkbox
                      checked={selectedIds.has(iface.id)}
                      onCheckedChange={() => handleToggle(iface.id)}
                      className="mt-0.5"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{iface.name}</span>
                        <span className={`text-xs px-1.5 py-0.5 rounded ${
                          iface.method === "GET" ? "bg-green-100 text-green-700" :
                          iface.method === "POST" ? "bg-blue-100 text-blue-700" :
                          iface.method === "PUT" ? "bg-yellow-100 text-yellow-700" :
                          "bg-red-100 text-red-700"
                        }`}>
                          {iface.method}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {iface.description || "无描述"}
                      </p>
                      <p className="text-xs font-mono text-muted-foreground/70 mt-1">
                        {iface.path}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            取消
          </Button>
          <Button onClick={handleAdd} disabled={selectedIds.size === 0}>
            添加 ({selectedIds.size})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
