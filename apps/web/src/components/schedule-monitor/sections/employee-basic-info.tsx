import { EmployeeContactAvatar } from "@/components/chat/contact-avatars"
import type { ChatViewContact } from "@/components/chat/chat-view-shared"
import { getContactDisplayName } from "@/components/chat/chat-view-shared"

export function EmployeeBasicInfo({ contact }: { contact?: ChatViewContact }) {
  if (!contact || contact.type !== "employee") return null

  const employee = contact.employee
  const displayName = getContactDisplayName(contact)

  return (
    <div className="flex items-center gap-4 rounded-lg border bg-muted/30 p-4">
      <EmployeeContactAvatar
        name={employee?.name}
        avatar={employee?.avatar}
        status={employee?.status}
        showStatus
        className="size-12"
      />
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-medium">{displayName}</h3>
        <p className="text-xs text-muted-foreground">
          {employee?.role ?? "数字员工"}
        </p>
        <div className="flex items-center gap-1.5">
          <span
            className={
              employee?.status === "online"
                ? "size-1.5 rounded-full bg-green-500"
                : "size-1.5 rounded-full bg-muted-foreground/50"
            }
          />
          <span className="text-xs text-muted-foreground">
            {employee?.status === "online" ? "在线" : "离线"}
          </span>
        </div>
      </div>
    </div>
  )
}
