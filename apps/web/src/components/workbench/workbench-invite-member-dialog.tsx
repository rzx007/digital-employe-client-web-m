import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { Button } from "@workspace/ui/components/button"

export interface InvitableEmployee {
  id: number
  name: string
}

/** 邀请员工到工作台：勾选员工 id 加入/移出 members。 */
export function WorkbenchInviteMemberDialog({
  open,
  onOpenChange,
  employees,
  memberIds,
  onToggle,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  employees: InvitableEmployee[]
  memberIds: number[]
  onToggle: (id: number, join: boolean) => void
}) {
  const memberSet = new Set(memberIds)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>邀请员工到工作台</DialogTitle>
        </DialogHeader>
        <div className="flex max-h-80 flex-col gap-1 overflow-auto">
          {employees.length === 0 && (
            <div className="text-xs text-muted-foreground">
              暂无可邀请的员工。员工需装有 workbench-builder 技能才能在工作台操控看板。
            </div>
          )}
          {employees.map((e) => {
            const joined = memberSet.has(e.id)
            return (
              <div
                key={e.id}
                className="flex items-center gap-2 rounded p-1 text-sm hover:bg-muted/40"
              >
                <span className="min-w-0 flex-1 truncate">{e.name}</span>
                <Button
                  size="sm"
                  variant={joined ? "secondary" : "outline"}
                  onClick={() => onToggle(e.id, !joined)}
                >
                  {joined ? "移出" : "加入"}
                </Button>
              </div>
            )
          })}
        </div>
      </DialogContent>
    </Dialog>
  )
}
