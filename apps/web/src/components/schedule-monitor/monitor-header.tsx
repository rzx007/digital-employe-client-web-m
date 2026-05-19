import { Button } from "@workspace/ui/components/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { IconMaximize, IconMinimize } from "@tabler/icons-react"
import type { Icon } from "@tabler/icons-react"
import { cn } from "@workspace/ui/lib/utils"
import { isElectron } from "@/lib/electron/host"

export interface MonitorHeaderProps {
  title: string
  onToggleFullscreen: () => void
  isFullscreen: boolean
}

export interface MonitorActionProps {
  icon: Icon
  label: string
  tooltip: string
  onClick: () => void
  className: string
}

export const MonitorAction = ({
  icon: IconComp,
  label,
  tooltip,
  onClick,
  className
}: MonitorActionProps) => {
  const button = (
    <Button
      className={cn("cursor-pointer rounded-full px-4", className)}
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
  onToggleFullscreen,
  isFullscreen,
}: MonitorHeaderProps) {
  const inElectron = isElectron()
  return (
    <div
      className={cn("flex items-center gap-2 border-b bg-muted/50 px-4 py-3")}
    >
      <div className="flex-1">
        <h2 className="text-sm font-medium">{title}</h2>
      </div>

      <div className="flex items-center gap-1">
        {!inElectron && <MonitorAction
          className="mr-4"
          icon={isFullscreen ? IconMinimize : IconMaximize}
          label={isFullscreen ? "退出全屏" : "全屏"}
          tooltip={isFullscreen ? "退出全屏" : "全屏"}
          onClick={onToggleFullscreen}
        />}

      </div>
    </div>
  )
}
