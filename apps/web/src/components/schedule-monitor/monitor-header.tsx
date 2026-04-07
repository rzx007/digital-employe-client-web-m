import { Button } from "@workspace/ui/components/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { IconMaximize, IconMinimize, IconX } from "@tabler/icons-react"
import type { Icon } from "@tabler/icons-react"
import { cn } from "@workspace/ui/lib/utils"

export interface MonitorHeaderProps {
  title: string
  onClose: () => void
  onToggleFullscreen: () => void
  isFullscreen: boolean
}

export interface MonitorActionProps {
  icon: Icon
  label: string
  tooltip: string
  onClick: () => void
}

export const MonitorAction = ({
  icon: IconComp,
  label,
  tooltip,
  onClick,
}: MonitorActionProps) => {
  const button = (
    <Button
      className="size-8 p-0 text-muted-foreground hover:text-foreground"
      size="sm"
      type="button"
      variant="ghost"
      onClick={onClick}
    >
      <IconComp className="size-4" />
      <span className="sr-only">{label}</span>
    </Button>
  )

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent>
          <p>{tooltip}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export function MonitorHeader({
  title,
  onClose,
  onToggleFullscreen,
  isFullscreen,
}: MonitorHeaderProps) {
  return (
    <div
      className={cn("flex items-center gap-2 border-b bg-muted/50 px-4 py-3")}
    >
      <div className="flex-1">
        <h2 className="text-sm font-medium">{title}</h2>
      </div>

      <div className="flex items-center gap-1">
        <MonitorAction
          icon={isFullscreen ? IconMinimize : IconMaximize}
          label={isFullscreen ? "退出全屏" : "全屏"}
          tooltip={isFullscreen ? "退出全屏" : "全屏"}
          onClick={onToggleFullscreen}
        />
        <MonitorAction
          icon={IconX}
          label="关闭"
          tooltip="关闭面板"
          onClick={onClose}
        />
      </div>
    </div>
  )
}
