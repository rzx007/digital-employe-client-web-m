import { Button } from "@workspace/ui/components/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import {
  IconCopy,
  IconDownload,
  IconMinimize,
  IconMaximize,
  IconX,
} from "@tabler/icons-react"
import type { Icon } from "@tabler/icons-react"
import { cn } from "@workspace/ui/lib/utils"
import type { Artifact } from "./artifact-types"

export interface ArtifactHeaderProps {
  artifact: Artifact
  onClose: () => void
  onToggleFullscreen: () => void
  isFullscreen: boolean
}

export interface ArtifactActionProps {
  icon: Icon
  label: string
  tooltip: string
  onClick: () => void
}

export const ArtifactAction = ({
  icon: Icon,
  label,
  tooltip,
  onClick,
}: ArtifactActionProps) => {
  const button = (
    <Button
      className="size-8 p-0 text-muted-foreground hover:text-foreground"
      size="sm"
      type="button"
      variant="ghost"
      onClick={onClick}
    >
      <Icon className="size-4" />
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

export const ArtifactHeader = ({
  artifact,
  onClose,
  onToggleFullscreen,
  isFullscreen,
}: ArtifactHeaderProps) => {
  const handleCopy = async () => {
    await navigator.clipboard.writeText(artifact.content)
  }

  const handleDownload = () => {
    const blob = new Blob([artifact.content], { type: "text/plain" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `${artifact.title}.txt`
    document.body.append(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <div
      className={cn("flex items-center gap-2 border-b bg-muted/50 px-4 py-3")}
    >
      <div className="flex-1">
        <h2 className="text-sm font-medium">{artifact.title}</h2>
      </div>

      <div className="flex items-center gap-1">
        <ArtifactAction
          icon={IconCopy}
          label="复制"
          tooltip="复制内容"
          onClick={handleCopy}
        />
        <ArtifactAction
          icon={IconDownload}
          label="下载"
          tooltip="下载文件"
          onClick={handleDownload}
        />
        <ArtifactAction
          icon={isFullscreen ? IconMinimize : IconMaximize}
          label={isFullscreen ? "退出全屏" : "全屏"}
          tooltip={isFullscreen ? "退出全屏" : "全屏"}
          onClick={onToggleFullscreen}
        />
        <ArtifactAction
          icon={IconX}
          label="关闭"
          tooltip="关闭面板"
          onClick={onClose}
        />
      </div>
    </div>
  )
}
