import * as React from "react"
import { motion, AnimatePresence } from "motion/react"
import {
  FileTree,
  FileTreeFile,
  FileTreeFolder,
} from "@workspace/ui/components/ai-elements/file-tree"
import { Button } from "@workspace/ui/components/button"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import {
  IconCopy,
  IconDownload,
  IconMaximize,
  IconMinimize,
  IconX,
  IconFile,
  IconCode,
  IconFileTypeCsv,
  IconPhoto,
  IconSparkles,
} from "@tabler/icons-react"
import { cn } from "@workspace/ui/lib/utils"
import type { ResourceEntry, ResourceList } from "@/types/artifact"
import { useConversationResourcesQuery, useResourceContentQuery } from "@/hooks/use-chat-queries"
import { CodeRenderer } from "./artifact-content/code-renderer"
import { ImageRenderer } from "./artifact-content/image-renderer"
import { SheetRenderer } from "./artifact-content/sheet-renderer"
import { TextRenderer } from "./artifact-content/text-renderer"
import type { Artifact } from "./artifact-types"

export interface ArtifactPanelProps {
  conversationId: string | number | null
  isOpen: boolean
  isFullscreen: boolean
  onClose: () => void
  onToggleFullscreen: () => void
  className?: string
}

const renderers: Record<string, React.ComponentType<{ artifact: Artifact; className?: string }>> = {
  text: TextRenderer,
  code: CodeRenderer,
  sheet: SheetRenderer,
  image: ImageRenderer,
  "skill-draft": CodeRenderer,
}

function getFileIcon(artifactType: string | null) {
  switch (artifactType) {
    case "code":
    case "skill-draft":
      return <IconCode className="size-4 text-blue-500" />
    case "sheet":
      return <IconFileTypeCsv className="size-4 text-green-500" />
    case "image":
      return <IconPhoto className="size-4 text-purple-500" />
    default:
      return <IconFile className="size-4 text-muted-foreground" />
  }
}

function renderEntry(entry: ResourceEntry) {
  if (entry.entry_type === "directory") {
    return (
      <FileTreeFolder key={entry.path} path={entry.path} name={entry.name}>
        {entry.children?.map(renderEntry)}
      </FileTreeFolder>
    )
  }
  return (
    <FileTreeFile
      key={entry.path}
      path={entry.path}
      name={entry.name}
      icon={getFileIcon(entry.artifact_type)}
    />
  )
}

export const ArtifactPanel = ({
  conversationId,
  isOpen,
  isFullscreen,
  onClose,
  onToggleFullscreen,
  className,
}: ArtifactPanelProps) => {
  const [selectedPath, setSelectedPath] = React.useState<string | null>(null)

  const { data: resourceList } = useConversationResourcesQuery(
    isOpen ? conversationId : null
  )

  const { data: resourceContent } = useResourceContentQuery(
    conversationId!,
    selectedPath
  )

  const selectedEntry = React.useMemo(() => {
    if (!selectedPath || !resourceList) return null
    const find = (entries: ResourceEntry[]): ResourceEntry | null => {
      for (const e of entries) {
        if (e.path === selectedPath && e.entry_type === "file") return e
        if (e.children) {
          const found = find(e.children)
          if (found) return found
        }
      }
      return null
    }
    return find([...resourceList.artifacts, ...resourceList.skills_draft])
  }, [selectedPath, resourceList])

  const artifactForRenderer = React.useMemo((): Artifact | null => {
    if (!resourceContent) return null
    return {
      id: `resource:${selectedPath}`,
      type: (resourceContent.artifact_type as Artifact["type"]) || "text",
      title: selectedPath?.split("/").pop() ?? "file",
      content: resourceContent.content,
      language: resourceContent.language ?? undefined,
    }
  }, [resourceContent, selectedPath])

  const Renderer = artifactForRenderer
    ? renderers[artifactForRenderer.type] ?? TextRenderer
    : null

  const handleCopy = async () => {
    if (artifactForRenderer) {
      await navigator.clipboard.writeText(artifactForRenderer.content)
    }
  }

  const handleDownload = () => {
    if (!artifactForRenderer) return
    const blob = new Blob([artifactForRenderer.content], { type: "text/plain" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = artifactForRenderer.title
    document.body.append(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

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
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h2 className="text-sm font-medium">资源管理器</h2>
            <div className="flex items-center gap-1">
              {artifactForRenderer && (
                <>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          className="size-8 p-0 text-muted-foreground hover:text-foreground"
                          size="sm"
                          variant="ghost"
                          onClick={handleCopy}
                        >
                          <IconCopy className="size-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>复制内容</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          className="size-8 p-0 text-muted-foreground hover:text-foreground"
                          size="sm"
                          variant="ghost"
                          onClick={handleDownload}
                        >
                          <IconDownload className="size-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>下载文件</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </>
              )}
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      className="size-8 p-0 text-muted-foreground hover:text-foreground"
                      size="sm"
                      variant="ghost"
                      onClick={onToggleFullscreen}
                    >
                      {isFullscreen ? <IconMinimize className="size-4" /> : <IconMaximize className="size-4" />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{isFullscreen ? "退出全屏" : "全屏"}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      className="size-8 p-0 text-muted-foreground hover:text-foreground"
                      size="sm"
                      variant="ghost"
                      onClick={onClose}
                    >
                      <IconX className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>关闭面板</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>

          <div className="flex min-h-0 flex-1">
            <div className="w-[220px] shrink-0 overflow-auto border-r">
              <FileTree
                selectedPath={selectedPath ?? undefined}
                onSelect={setSelectedPath}
                className="h-full rounded-none border-0"
              >
                {resourceList && resourceList.artifacts.length > 0 && (
                  <FileTreeFolder path="/artifacts" name="artifacts">
                    {resourceList.artifacts.map(renderEntry)}
                  </FileTreeFolder>
                )}
                {resourceList && resourceList.skills_draft.length > 0 && (
                  <FileTreeFolder path="/skills-draft" name="skills-draft">
                    {resourceList.skills_draft.map((skill) => (
                      <FileTreeFolder
                        key={skill.path}
                        path={skill.path}
                        name={skill.name}
                      >
                        <span className="flex items-center gap-1">
                          <IconSparkles className="size-3 text-amber-500" />
                        </span>
                        {skill.children?.map(renderEntry)}
                      </FileTreeFolder>
                    ))}
                  </FileTreeFolder>
                )}
              </FileTree>
              {(!resourceList ||
                (resourceList.artifacts.length === 0 &&
                  resourceList.skills_draft.length === 0)) && (
                <div className="p-4 text-center text-xs text-muted-foreground">
                  暂无资源文件
                </div>
              )}
            </div>

            <div className="flex min-w-0 flex-1 flex-col">
              {artifactForRenderer && Renderer ? (
                <Renderer artifact={artifactForRenderer} className="flex-1" />
              ) : (
                <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                  选择文件查看内容
                </div>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
