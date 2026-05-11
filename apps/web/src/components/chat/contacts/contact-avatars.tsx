import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@workspace/ui/components/avatar"
import { Badge } from "@workspace/ui/components/badge"
import { cn } from "@workspace/ui/lib/utils"

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
        <AvatarImage src={avatar} />
        <AvatarFallback
          className={cn(
            "rounded-none! bg-primary font-medium text-primary-foreground",
            fallbackClassName
          )}
        >
          {name?.slice(0, 1)}
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

export function GroupMembersAvatar({
  participants = [],
  className,
  itemClassName,
  fallbackClassName,
  placeholderClassName,
}: {
  participants?: Array<{ id: string; name: string; avatar?: string }>
  className?: string
  itemClassName?: string
  fallbackClassName?: string
  placeholderClassName?: string
}) {
  const items = participants.slice(0, 4)
  const placeholdersCount = Math.max(0, 4 - items.length)

  return (
    <div className={cn("grid grid-cols-2 border", className)}>
      {items.map((participant) => (
        <Avatar
          key={participant.id}
          className={cn(
            "h-4 w-4 rounded-none border border-background",
            itemClassName
          )}
        >
          <AvatarImage src={participant.avatar} className="rounded-none" />
          <AvatarFallback
            className={cn(
              "rounded-none! bg-primary text-[9px] font-medium text-primary-foreground",
              fallbackClassName
            )}
          >
            {participant.name.slice(0, 1)}
          </AvatarFallback>
        </Avatar>
      ))}
      {Array.from({ length: placeholdersCount }).map((_, index) => (
        <div
          key={`placeholder-${index}`}
          className={cn(
            "h-4 w-4 rounded-none border bg-border",
            placeholderClassName
          )}
        />
      ))}
    </div>
  )
}
