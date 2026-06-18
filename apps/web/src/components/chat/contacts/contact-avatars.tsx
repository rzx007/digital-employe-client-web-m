import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@workspace/ui/components/avatar"
import { Badge } from "@workspace/ui/components/badge"
import { cn } from "@workspace/ui/lib/utils"
import { avatarColorClass, avatarInitials } from "@/lib/avatar"

type EmployeeStatus = "online" | "busy" | "offline"

export function EmployeeContactAvatar({
  name,
  avatar,
  status,
  showStatus = false,
  className,
  avatarClassName,
  fallbackClassName,
  statusClassName,
}: {
  name?: string
  avatar?: string
  status?: EmployeeStatus
  showStatus?: boolean
  className?: string
  avatarClassName?: string
  fallbackClassName?: string
  statusClassName?: string
}) {
  return (
    <div className={cn("relative", className)}>
      <Avatar className={cn("size-9", avatarClassName)}>
        {avatar ? <AvatarImage src={avatar} alt={name ?? ""} /> : null}
        <AvatarFallback
          className={cn(
            "rounded-none! text-xs font-medium",
            avatarColorClass(name),
            fallbackClassName
          )}
        >
          {avatarInitials(name)}
        </AvatarFallback>
      </Avatar>
      {showStatus && (
        <Badge
          className={cn(
            "absolute right-0 bottom-0 h-2 w-2 rounded-full border-2 border-background p-0",
            status === "online" && "bg-green-500",
            status === "busy" && "bg-red-500",
            status === "offline" && "bg-gray-400",
            statusClassName
          )}
        />
      )}
    </div>
  )
}
