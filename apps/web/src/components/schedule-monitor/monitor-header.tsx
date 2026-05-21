import { Button } from "@workspace/ui/components/button"
import { IconX } from "@tabler/icons-react"
import { cn } from "@workspace/ui/lib/utils"

export interface MonitorHeaderProps {
  title: string
  onClose: () => void
  className?: string
}

export function MonitorHeader({ title, onClose, className }: MonitorHeaderProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 border-b bg-muted/50 px-4 py-3",
        className
      )}
    >
      <h2 className="min-w-0 flex-1 truncate text-sm font-medium">{title}</h2>
      <Button
        variant="ghost"
        size="icon-sm"
        type="button"
        aria-label="关闭监控面板"
        onClick={onClose}
      >
        <IconX className="size-4" />
      </Button>
    </div>
  )
}
