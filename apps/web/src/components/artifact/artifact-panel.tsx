import { motion, AnimatePresence } from "motion/react"
import { cn } from "@workspace/ui/lib/utils"
import { ArtifactHeader } from "./artifact-header"
import { CodeRenderer } from "./artifact-content/code-renderer"
import { ImageRenderer } from "./artifact-content/image-renderer"
import { SheetRenderer } from "./artifact-content/sheet-renderer"
import { TextRenderer } from "./artifact-content/text-renderer"
import type { Artifact } from "./artifact-types"

export interface ArtifactPanelProps {
  artifact: Artifact | null
  isOpen: boolean
  isFullscreen: boolean
  onClose: () => void
  onToggleFullscreen: () => void
  className?: string
}

const renderers = {
  text: TextRenderer,
  code: CodeRenderer,
  sheet: SheetRenderer,
  image: ImageRenderer,
}

export const ArtifactPanel = ({
  artifact,
  isOpen,
  isFullscreen,
  onClose,
  onToggleFullscreen,
  className,
}: ArtifactPanelProps) => {
  if (!artifact) return null

  const Renderer = renderers[artifact.type]

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={isFullscreen ? { opacity: 0 } : { x: "100%" }}
          animate={isFullscreen ? { opacity: 1 } : { x: 0 }}
          exit={isFullscreen ? { opacity: 0 } : { x: "100%" }}
          transition={{ type: "spring", damping: 25, stiffness: 200 }}
          className={cn(
            "flex h-full flex-col overflow-hidden rounded-lg border bg-background shadow-xl",
            isFullscreen ? "fixed inset-0 z-50 rounded-none" : "w-full",
            className
          )}
        >
          <ArtifactHeader
            artifact={artifact}
            onClose={onClose}
            onToggleFullscreen={onToggleFullscreen}
            isFullscreen={isFullscreen}
          />
          <Renderer artifact={artifact} />
        </motion.div>
      )}
    </AnimatePresence>
  )
}
