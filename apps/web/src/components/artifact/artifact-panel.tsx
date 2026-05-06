import * as React from "react"
import { motion, AnimatePresence } from "motion/react"
import {
  FileTree,
  FileTreeFile,
  FileTreeFolder,
} from "@workspace/ui/components/ai-elements/file-tree"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
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
  IconX,
  IconFile,
  IconCode,
  IconFileTypeCsv,
  IconPhoto,
  IconSparkles,
  IconSearch,
} from "@tabler/icons-react"
import { cn } from "@workspace/ui/lib/utils"
import type { ResourceEntry, ResourceList } from "@/api/types"
import { useConversationResourcesQuery, useResourceContentQuery } from "@/hooks/use-chat-queries"
import { useArtifactStore } from "@/stores/artifact-store"
import { CodeRenderer } from "./artifact-content/code-renderer"
import { ImageRenderer } from "./artifact-content/image-renderer"
import { SheetRenderer } from "./artifact-content/sheet-renderer"
import { TextRenderer } from "./artifact-content/text-renderer"
import type { Artifact } from "./artifact-types"

export interface ArtifactPanelProps {
  conversationId: string | number | null
  isOpen: boolean
  onClose: () => void
  className?: string
}

const renderers: Record<string, React.ComponentType<{ artifact: Artifact; className?: string }>> = {
  text: TextRenderer,
  code: CodeRenderer,
  sheet: SheetRenderer,
  image: ImageRenderer,
  "skill-draft": CodeRenderer,
}

const EMPTY_RESOURCE_LIST: ResourceList = {
  artifacts: [],
  uploads: [],
  skills_draft: [],
}

function getParentPaths(path: string) {
  const segments = path.split("/").filter(Boolean)
  const parentPaths: string[] = []

  for (let i = 1; i <= segments.length; i++) {
    parentPaths.push(`/${segments.slice(0, i).join("/")}`)
  }

  return parentPaths
}

function countFiles(entries: ResourceEntry[]): number {
  return entries.reduce((count, entry) => {
    if (entry.entry_type === "file") {
      return count + 1
    }

    return count + countFiles(entry.children ?? [])
  }, 0)
}

function hasEntries(entries: ResourceEntry[]) {
  return entries.length > 0
}

function matchesEntry(entry: ResourceEntry, query: string) {
  const needle = query.toLowerCase()
  return (
    entry.name.toLowerCase().includes(needle) ||
    entry.path.toLowerCase().includes(needle)
  )
}

function filterEntries(entries: ResourceEntry[], query: string): ResourceEntry[] {
  const trimmed = query.trim()
  if (!trimmed) {
    return entries
  }

  return entries.flatMap((entry) => {
    const children = entry.children
      ? filterEntries(entry.children, trimmed)
      : null
    const isMatch = matchesEntry(entry, trimmed)

    if (isMatch) {
      return [entry]
    }

    if (children && children.length > 0) {
      return [{ ...entry, children }]
    }

    return []
  })
}

function collectDirectoryPaths(entries: ResourceEntry[]) {
  const paths = new Set<string>()

  function visit(entry: ResourceEntry) {
    if (entry.entry_type !== "directory") {
      return
    }

    paths.add(entry.path)
    for (const child of entry.children ?? []) {
      visit(child)
    }
  }

  for (const entry of entries) {
    visit(entry)
  }

  return paths
}

function formatFileSize(size: number | undefined) {
  if (typeof size !== "number") {
    return null
  }

  if (size < 1024) {
    return `${size} B`
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`
  }

  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function getArtifactTypeLabel(artifactType: string | null | undefined) {
  switch (artifactType) {
    case "code":
      return "代码"
    case "image":
      return "图片"
    case "sheet":
      return "表格"
    case "skill-draft":
      return "技能草稿"
    case "text":
      return "文本"
    default:
      return "文件"
  }
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
      <FileTreeFolder className="truncate" key={entry.path} path={entry.path} name={entry.name}>
        {entry.children?.map(renderEntry)}
      </FileTreeFolder>
    )
  }
  return (
    <FileTreeFile
      className="w-full min-w-0 cursor-pointer"
      title={entry.name}
      key={entry.path}
      path={entry.path}
      name={entry.name}
      icon={getFileIcon(entry.artifact_type)}
    >
      <span className="size-4 shrink-0" />
      <span className="shrink-0">{getFileIcon(entry.artifact_type)}</span>
      <span className="min-w-0 flex-1 truncate">{entry.name}</span>
    </FileTreeFile>
  )
}

export const ArtifactPanel = ({
  conversationId,
  isOpen,
  onClose,
  className,
}: ArtifactPanelProps) => {
  const [selectedPath, setSelectedPath] = React.useState<string | null>(null)
  const [expandedPaths, setExpandedPaths] = React.useState<Set<string>>(
    () => new Set()
  )
  const [searchQuery, setSearchQuery] = React.useState("")
  const activeResourcePath = useArtifactStore((s) => s.activeResourcePath)

  React.useEffect(() => {
    if (!activeResourcePath) return

    setSelectedPath(activeResourcePath)
    setExpandedPaths((current) => {
      const next = new Set(current)
      for (const path of getParentPaths(activeResourcePath)) {
        next.add(path)
      }
      return next
    })
  }, [activeResourcePath])

  const { data: resourceList } = useConversationResourcesQuery(
    isOpen ? conversationId : null
  )
  const resources = resourceList ?? EMPTY_RESOURCE_LIST
  const filteredArtifacts = React.useMemo(
    () => filterEntries(resources.artifacts, searchQuery),
    [resources.artifacts, searchQuery]
  )
  const filteredSkillsDraft = React.useMemo(
    () => filterEntries(resources.skills_draft, searchQuery),
    [resources.skills_draft, searchQuery]
  )
  const filteredUploads = React.useMemo(
    () => filterEntries(resources.uploads, searchQuery),
    [resources.uploads, searchQuery]
  )
  const totalFiles = React.useMemo(
    () => countFiles(resources.artifacts) + countFiles(resources.uploads) + countFiles(resources.skills_draft),
    [resources.artifacts, resources.uploads, resources.skills_draft]
  )
  const filteredFiles = React.useMemo(
    () => countFiles(filteredArtifacts) + countFiles(filteredUploads) + countFiles(filteredSkillsDraft),
    [filteredArtifacts, filteredUploads, filteredSkillsDraft]
  )
  const hasResources = totalFiles > 0
  const hasSearchQuery = searchQuery.trim().length > 0
  const hasFilteredResources =
    hasEntries(filteredArtifacts) || hasEntries(filteredUploads) || hasEntries(filteredSkillsDraft)

  React.useEffect(() => {
    if (!hasSearchQuery) return

    setExpandedPaths((current) => {
      const next = new Set(current)
      if (filteredArtifacts.length > 0) {
        next.add("/artifacts")
      }
      if (filteredUploads.length > 0) {
        next.add("/uploads")
      }
      if (filteredSkillsDraft.length > 0) {
        next.add("/skills-draft")
      }
      for (const path of collectDirectoryPaths([
        ...filteredArtifacts,
        ...filteredUploads,
        ...filteredSkillsDraft,
      ])) {
        next.add(path)
      }
      return next
    })
  }, [filteredArtifacts, filteredUploads, filteredSkillsDraft, hasSearchQuery])

  const selectedEntry = React.useMemo(() => {
    if (!selectedPath || !resourceList) return null
    const find = (entries: ResourceEntry[]): ResourceEntry | null => {
      for (const e of entries) {
        if (e.path === selectedPath) return e
        if (e.children) {
          const found = find(e.children)
          if (found) return found
        }
      }
      return null
    }
    return find([...resourceList.artifacts, ...resourceList.uploads, ...resourceList.skills_draft])
  }, [selectedPath, resourceList])

  const selectedFilePath =
    selectedEntry?.entry_type === "file" ? selectedEntry.path : null

  const { data: resourceContent } = useResourceContentQuery(
    conversationId!,
    selectedFilePath
  )

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
  const selectedFileSize = formatFileSize(selectedEntry?.size)
  const selectedTypeLabel = getArtifactTypeLabel(selectedEntry?.artifact_type)

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
          initial={{ x: "100%" }}
          animate={{ x: 0 }}
          exit={{ x: "100%" }}
          transition={{ type: "spring", damping: 25, stiffness: 200 }}
          className={cn(
            "flex h-full min-w-0 flex-col overflow-hidden rounded-lg border bg-background shadow-xl",
            className
          )}
        >
          <div className="flex min-w-0 items-center justify-between gap-3 border-b px-4 py-3">
            <div className="min-w-0">
              <h2 className="text-sm font-medium">资源管理器</h2>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {hasResources
                  ? `${totalFiles} 个文件${hasSearchQuery ? `，匹配 ${filteredFiles} 个` : ""}`
                  : "本轮暂无资源文件"}
              </p>
            </div>
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

          <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
            <div className="flex w-72 min-w-0 shrink-0 flex-col overflow-hidden border-r bg-muted/10">
              <div className="space-y-2 border-b p-3">
                <div className="relative">
                  <IconSearch className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    aria-label="搜索资源文件"
                    className="h-8 pl-7"
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="搜索文件或路径"
                    value={searchQuery}
                  />
                </div>
                {hasSearchQuery && (
                  <p className="text-[11px] text-muted-foreground">
                    找到 {filteredFiles} 个匹配文件
                  </p>
                )}
              </div>

              <ScrollArea className="min-h-0 min-w-0 flex-1">
                {hasResources && hasFilteredResources ? (
                  <FileTree
                    expanded={expandedPaths}
                    selectedPath={selectedPath ?? undefined}
                    onExpandedChange={setExpandedPaths}
                    onSelect={setSelectedPath}
                    className="h-full rounded-none border-0 bg-transparent"
                  >
                    {filteredArtifacts.length > 0 && (
                      <FileTreeFolder path="/artifacts" name="artifacts">
                        {filteredArtifacts.map(renderEntry)}
                      </FileTreeFolder>
                    )}
                    {filteredUploads.length > 0 && (
                      <FileTreeFolder path="/uploads" name="uploads">
                        {filteredUploads.map(renderEntry)}
                      </FileTreeFolder>
                    )}
                    {filteredSkillsDraft.length > 0 && (
                      <FileTreeFolder path="/skills-draft" name="skills-draft">
                        {filteredSkillsDraft.map((skill) => (
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
                ) : (
                  <div className="flex min-h-48 flex-col items-center justify-center px-4 text-center">
                    <IconFile className="mb-2 size-8 text-muted-foreground/50" />
                    <p className="text-sm text-muted-foreground">
                      {hasSearchQuery ? "没有匹配的资源" : "暂无资源文件"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground/80">
                      {hasSearchQuery
                        ? "换个关键词试试"
                        : "产物文件会在这里展示"}
                    </p>
                  </div>
                )}
              </ScrollArea>
            </div>

            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              <div className="flex min-w-0 items-center justify-between gap-3 border-b bg-background/95 px-4 py-3">
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    {selectedEntry && getFileIcon(selectedEntry.artifact_type)}
                    <h3 className="truncate text-sm font-medium">
                      {selectedEntry?.name ?? "选择文件"}
                    </h3>
                  </div>
                  <div className="mt-1 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                    <span className="shrink-0">{selectedTypeLabel}</span>
                    {selectedFileSize && (
                      <>
                        <span className="shrink-0">·</span>
                        <span className="shrink-0">{selectedFileSize}</span>
                      </>
                    )}
                    {selectedEntry?.path && (
                      <>
                        <span className="shrink-0">·</span>
                        <span className="truncate">{selectedEntry.path}</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
              {artifactForRenderer && Renderer ? (
                <Renderer
                  artifact={artifactForRenderer}
                  className="min-h-0 min-w-0 flex-1"
                />
              ) : (
                <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden p-6 text-sm text-muted-foreground">
                  <div className="max-w-xs text-center">
                    <IconFile className="mx-auto mb-3 size-10 text-muted-foreground/50" />
                    <p>
                      {selectedEntry?.entry_type === "directory"
                        ? "这是一个文件夹"
                        : "选择文件查看内容"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground/80">
                      {selectedEntry?.entry_type === "directory"
                        ? "展开左侧目录并选择具体文件进行预览"
                        : "可在左侧搜索或浏览资源文件"}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
