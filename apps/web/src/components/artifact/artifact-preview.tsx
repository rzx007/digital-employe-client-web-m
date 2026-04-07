import { motion } from "motion/react"
import {
  IconArrowDown,
  IconFileCode,
  IconFileText,
  IconMagnet,
  IconTable,
} from "@tabler/icons-react"
import { cn } from "@workspace/ui/lib/utils"
import type { Artifact } from "./artifact-types"
import { Button } from "@workspace/ui/components/button"
import type { ComponentType } from "react"
import gridImage from "@/assets/doc-grid.png"
import canvasImage from "@/assets/doc-canvas-card-fallback.png"

export interface ArtifactPreviewProps {
  artifact: Artifact
  onClick: () => void
  className?: string
}

const typeIcons: Record<Artifact["type"], ComponentType<any>> = {
  text: IconFileText,
  code: IconFileCode,
  sheet: IconTable,
  image: IconMagnet,
}

const typeLabels: Record<Artifact["type"], string> = {
  text: "文本",
  code: "代码",
  sheet: "表格",
  image: "图像",
}

export const ArtifactPreview = ({
  artifact,
  onClick,
  className,
  ...props
}: ArtifactPreviewProps) => {
  const Icon = typeIcons[artifact.type]

  return (
    <motion.div
      onClick={onClick}
      className={cn(
        "group-artifact relative flex w-72 md:w-90 cursor-pointer items-center gap-3 overflow-hidden rounded-xl border border-border/70 bg-background p-5 transition-colors hover:shadow-md",
        className
      )}
      {...props}
    >
      <img
        src={gridImage}
        alt={artifact.title}
        width={120}
        height={110}
        className="absolute top-1 -left-1"
      />
      <div className="mr-32 space-y-2">
        <Icon className="h-5 w-5 text-primary/70" />
        <div className="flex flex-col gap-1">
          <p className="text-base text-secondary-foreground/75">
            {artifact.title}
          </p>
          <p className="text-xs font-thin text-muted-foreground">
            {typeLabels[artifact.type]}
          </p>
        </div>
      </div>
      <div className="absolute top-6 -right-1 h-35 w-34 rounded-xl border border-border/60 bg-background shadow-md transition-transform group-artifact-hover:-rotate-5">
        <img
          src={canvasImage}
          alt={artifact.title}
          width={100}
          height={100}
          className="h-full w-full object-cover"
        />
      </div>
      <Button
        size="icon"
        variant="outline"
        className="absolute right-4 bottom-4 size-8 p-0 opacity-0 transition-opacity group-artifact-hover:opacity-100"
      >
        <IconArrowDown className="size-4" />
      </Button>
    </motion.div>
  )
}
