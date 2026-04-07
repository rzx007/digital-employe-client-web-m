import * as React from "react"
import { IconCalendar, IconSearch } from "@tabler/icons-react"
import { Input } from "@workspace/ui/components/input"
import { cn } from "@workspace/ui/lib/utils"

export function CalendarPlaceholder({
  variant = "sidebar",
  className,
  ...props
}: React.ComponentProps<"div"> & { variant?: "sidebar" | "content" }) {
  if (variant === "content") {
    return (
      <div
        className={cn(
          "flex h-full flex-col items-center justify-center text-muted-foreground/60",
          className
        )}
        {...props}
      >
        <IconCalendar className="size-16 stroke-1" />
        <p className="mt-4 text-lg font-medium">员工排版日历</p>
        <p className="mt-1 text-sm">功能开发中，敬请期待</p>
      </div>
    )
  }

  return (
    <div
      className={cn(
        "flex h-full w-full flex-col border-r bg-muted/50",
        className
      )}
      {...props}
    >
      <div className="flex items-center gap-1.5 border-b px-3 py-2">
        <div className="relative flex-1">
          <IconSearch className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input className="h-7 pl-7 text-xs bg-background border-none" placeholder="搜索日历..." />
        </div>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center px-2 text-muted-foreground/60">
        <IconCalendar className="size-12 stroke-1" />
        <p className="mt-3 text-xs">日历功能开发中</p>
        <p className="text-xs">敬请期待</p>
      </div>
    </div>
  )
}
