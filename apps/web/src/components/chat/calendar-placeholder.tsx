import * as React from "react"
import { IconCalendar } from "@tabler/icons-react"
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
      <div className="border-b px-4 py-3">
        <h2 className="text-sm font-medium">日历</h2>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center text-muted-foreground/60 px-2">
        <IconCalendar className="size-12 stroke-1" />
        <p className="mt-3 text-xs">日历功能开发中</p>
        <p className="text-xs">敬请期待</p>
      </div>
    </div>
  )
}
