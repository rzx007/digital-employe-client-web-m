import type * as React from "react"
import { cn } from "@workspace/ui/lib/utils"

export function ThemeCard({
  label,
  icon: Icon,
  description,
  active,
  onClick,
}: {
  label: string
  icon: React.ComponentType<{ className?: string }>
  description: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-col items-center gap-2 rounded-lg border-2 p-4 transition-colors hover:bg-accent/50",
        active ? "border-primary bg-primary/5" : "border-transparent",
      )}
    >
      <div
        className={cn(
          "flex size-10 items-center justify-center rounded-lg transition-colors",
          active
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-muted-foreground",
        )}
      >
        <Icon className="size-5" />
      </div>
      <span className="text-sm font-medium">{label}</span>
      <span className="text-xs text-muted-foreground">{description}</span>
    </button>
  )
}
