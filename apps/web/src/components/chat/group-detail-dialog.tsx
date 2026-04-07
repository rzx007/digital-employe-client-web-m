import { IconMessage, IconUsers } from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { Separator } from "@workspace/ui/components/separator"
import type { Contact } from "@/lib/mock-data/ai-employees"
import { useChatStore } from "@/stores/chat-store"

import { EmployeeContactAvatar } from "./contact-avatars"

interface GroupDetailDialogProps {
  contact: Contact
  open: boolean
  onOpenChange: (open: boolean) => void
}

const statusLabelMap: Record<string, string> = {
  online: "在线",
  busy: "忙碌",
  offline: "离线",
}

export function GroupDetailDialog({
  contact,
  open,
  onOpenChange,
}: GroupDetailDialogProps) {
  const group = contact.group
  const participants = group?.participants ?? []

  const { setSelectedContactId } = useChatStore()

  const handleSendMessage = () => {
    onOpenChange(false)
    setSelectedContactId(group?.id ?? null)
  }

  const onlineCount = participants.filter((p) => p.status === "online").length

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-md">
        <DialogHeader className="px-4 pt-5 pb-3 text-center">
          <div className="flex justify-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary">
              <IconUsers className="size-7 text-primary-foreground" />
            </div>
          </div>
          <DialogTitle className="text-base">{group?.name}</DialogTitle>
          <DialogDescription className="text-xs">
            {participants.length} 位成员
            {onlineCount > 0 && `，${onlineCount} 人在线`}
          </DialogDescription>
        </DialogHeader>

        <Separator />

        <ScrollArea className="min-h-0 flex-1">
          <div className="px-2 py-2">
            <div className="flex items-center gap-1.5 px-2 pb-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                群成员 ({participants.length})
              </span>
            </div>
            <div className="space-y-0.5">
              {participants.map((member) => (
                <div
                  key={member.id}
                  className="flex items-center gap-2.5 rounded-md px-2 py-2 transition-colors hover:bg-accent"
                >
                  <EmployeeContactAvatar
                    name={member.name}
                    avatar={member.avatar}
                    status={member.status}
                    showStatus
                    avatarClassName="h-9 w-9"
                    statusClassName="h-2.5 w-2.5"
                  />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-xs font-medium">
                      {member.name}
                    </span>
                    <span className="truncate text-[11px] text-muted-foreground max-w-64">
                      {member.role}
                    </span>
                  </div>
                  <span className="text-[11px] text-muted-foreground">
                    {statusLabelMap[member.status] ?? "离线"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </ScrollArea>

        <Separator />

        <DialogFooter className="px-4 py-3">
          <Button onClick={handleSendMessage} className="w-full" size="sm">
            <IconMessage className="size-3.5" />
            发消息
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
