import * as React from "react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { Button } from "@workspace/ui/components/button"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { Avatar, AvatarFallback } from "@workspace/ui/components/avatar"
import { Checkbox } from "@workspace/ui/components/checkbox"
import { cn } from "@workspace/ui/lib/utils"
import type { AIEmployee } from "@/lib/mock-data/ai-employees"

interface CreateGroupDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  employees: AIEmployee[]
  onCreate: (selectedEmployees: AIEmployee[]) => void
}

export function CreateGroupDialog({
  open,
  onOpenChange,
  employees = [],
  onCreate,
}: CreateGroupDialogProps) {
  const [selectedEmployees, setSelectedEmployees] = React.useState<Set<string>>(
    new Set()
  )

  const toggleEmployee = (id: string) => {
    const newSelected = new Set(selectedEmployees)
    if (newSelected.has(id)) {
      newSelected.delete(id)
    } else {
      newSelected.add(id)
    }
    setSelectedEmployees(newSelected)
  }

  const selectedEmployeesList = employees.filter((emp) =>
    selectedEmployees.has(emp.id)
  )

  const handleCreate = () => {
    onCreate(selectedEmployeesList)
    setSelectedEmployees(new Set())
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>创建群聊</DialogTitle>
          <DialogDescription>选择要添加到群聊的AI员工</DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[400px] px-1">
          <div className="space-y-2 py-2">
            {employees.map((employee) => (
              <div
                key={employee.id}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 transition-colors hover:bg-accent",
                  selectedEmployees.has(employee.id) && "bg-accent/50"
                )}
              >
                <Checkbox
                  id={employee.id}
                  checked={selectedEmployees.has(employee.id)}
                  onCheckedChange={() => toggleEmployee(employee.id)}
                />
                <Avatar className="h-10 w-10">
                  <AvatarFallback className="bg-primary font-medium text-primary-foreground">
                    {employee.name.slice(0, 1)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-xs font-medium">
                    {employee.name}
                  </span>
                  <span className="truncate text-xs text-muted-foreground max-w-64">
                    {employee.role}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              setSelectedEmployees(new Set())
              onOpenChange(false)
            }}
          >
            取消
          </Button>
          <Button disabled={selectedEmployees.size < 2} onClick={handleCreate}>
            创建群聊（{selectedEmployees.size}）
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
