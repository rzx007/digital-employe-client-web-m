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
import { useShallow } from "zustand/react/shallow"
import {
  IconCopy,
  IconDownload,
  IconX,
  IconFile,
  IconCode,
  IconFileTypeCsv,
  IconPhoto,
  IconSparkles,
  IconRefresh,
  IconSearch,
  IconTrash,
  IconFileImport,
  IconLoader,
} from "@tabler/icons-react"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@workspace/ui/components/context-menu"
import { cn } from "@workspace/ui/lib/utils"
import type { ResourceEntry, ResourceList } from "@/api/types"
import {
  useConversationResourcesQuery,
  useResourceContentQuery,
} from "@/hooks/use-chat-queries"
import { deleteResource, downloadResource } from "@/api/chat"
import { useQueryClient } from "@tanstack/react-query"
import { chatKeys } from "@/lib/query-keys/chat"
import { detectLanguage } from "@/components/chat/shared/code-highlight"
import {
  findEntryByPath,
  findPendingByPath,
  mergePendingIntoResourceList,
  pendingToResourceEntry,
} from "@/lib/chat/pending-resource-utils"
import {
  useArtifactStore,
  type PendingResource,
} from "@/stores/artifact-store"
import { toast } from "sonner"
import {
  getPreviewableTypeLabel,
  resolveArtifactRenderer,
} from "./artifact-content/resolve-renderer"
import type { Artifact } from "./artifact-types"
import { ImportDraftSkillDialog } from "./import-draft-skill-dialog"

export interface ArtifactPanelProps {
  conversationId: string | number | null
  isOpen: boolean
  onClose: () => void
  className?: string
  /** embedded：置于 Sheet 等容器内，不使用侧滑入场动画 */
  presentation?: "slide-over" | "embedded"
}

const EMPTY_RESOURCE_LIST: ResourceList = {
  artifacts: [],
  uploads: [],
  skills_draft: [],
}
const EMPTY_PENDING_LIST: PendingResource[] = []

/** 侧栏树内文件名/文件夹名展示宽度；完整名见原生 title */
const ARTIFACT_TREE_NAME_ROW_CLASS =
  "[&_button.min-w-0.flex-1>span:last-child]:max-w-[11rem]"
const ARTIFACT_TREE_FILE_NAME_MAX_W = "max-w-[11rem]"
/** 预览区标题栏文件名 */
const ARTIFACT_DETAIL_NAME_MAX_W = "max-w-[min(100%,22rem)]"

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

function filterEntries(
  entries: ResourceEntry[],
  query: string
): ResourceEntry[] {
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

function getArtifactTypeLabel(
  artifactType: string | null | undefined,
  filePath?: string | null
) {
  const previewLabel = getPreviewableTypeLabel(filePath)
  if (previewLabel) return previewLabel

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
    case "document":
      return "文档"
    default:
      return "文件"
  }
}

const DOCUMENT_EXTENSIONS = new Set([
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
])

function isDocumentFile(path: string | null | undefined): boolean {
  if (!path) return false
  const ext = path.split(".").pop()?.toLowerCase()
  return ext ? DOCUMENT_EXTENSIONS.has(ext) : false
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
    case "document":
      return <IconFile className="size-4 text-orange-500" />
    default:
      return <IconFile className="size-4 text-muted-foreground" />
  }
}

function ResourceContextMenu({
  entry,
  conversationId,
  onDelete,
  onRefresh,
  pendingOnly = false,
}: {
  entry: ResourceEntry
  conversationId: string | number
  onDelete: (entry: ResourceEntry) => void
  onRefresh: () => void
  pendingOnly?: boolean
}) {
  const handleDownload = async () => {
    await downloadResource(conversationId, entry.path)
  }

  return (
    <ContextMenuContent className="w-36">
      {!pendingOnly && (
        <ContextMenuItem onSelect={handleDownload}>
          <IconDownload className="size-4 text-muted-foreground" />
          <span>下载</span>
        </ContextMenuItem>
      )}
      <ContextMenuItem onSelect={onRefresh}>
        <IconRefresh className="size-4 text-muted-foreground" />
        <span>刷新</span>
      </ContextMenuItem>
      {!pendingOnly && (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" onSelect={() => onDelete(entry)}>
            <IconTrash className="size-4" />
            <span>删除</span>
          </ContextMenuItem>
        </>
      )}
    </ContextMenuContent>
  )
}

function SkillDraftContextMenu({
  entry,
  conversationId,
  onDelete,
  onRefresh,
  onImport,
}: {
  entry: ResourceEntry
  conversationId: string | number
  onDelete: (entry: ResourceEntry) => void
  onRefresh: () => void
  onImport: (entry: ResourceEntry) => void
}) {
  const handleDownload = async () => {
    await downloadResource(conversationId, entry.path)
  }

  return (
    <ContextMenuContent className="w-42">
      <ContextMenuItem onSelect={() => onImport(entry)}>
        <IconFileImport className="size-4 text-muted-foreground" />
        <span>导入到技能库</span>
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={handleDownload}>
        <IconDownload className="size-4 text-muted-foreground" />
        <span>下载</span>
      </ContextMenuItem>
      <ContextMenuItem onSelect={onRefresh}>
        <IconRefresh className="size-4 text-muted-foreground" />
        <span>刷新</span>
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem variant="destructive" onSelect={() => onDelete(entry)}>
        <IconTrash className="size-4" />
        <span>删除</span>
      </ContextMenuItem>
    </ContextMenuContent>
  )
}

function renderEntry(
  entry: ResourceEntry,
  conversationId: string | number,
  onDelete: (entry: ResourceEntry) => void,
  onRefresh: () => void,
  getPendingForPath: (path: string) => PendingResource | null
) {
  if (entry.entry_type === "directory") {
    return (
      <ContextMenu key={entry.path}>
        <ContextMenuTrigger asChild>
          <div>
            <FileTreeFolder
              className={ARTIFACT_TREE_NAME_ROW_CLASS}
              path={entry.path}
              name={entry.name}
              title={entry.name}
            >
              {entry.children?.map((child) =>
                renderEntry(
                  child,
                  conversationId,
                  onDelete,
                  onRefresh,
                  getPendingForPath
                )
              )}
            </FileTreeFolder>
          </div>
        </ContextMenuTrigger>
        <ResourceContextMenu
          entry={entry}
          conversationId={conversationId}
          onDelete={onDelete}
          onRefresh={onRefresh}
        />
      </ContextMenu>
    )
  }

  const pending = getPendingForPath(entry.path)
  const isPendingStreaming = pending?.isStreaming === true

  return (
    <ContextMenu key={entry.path}>
      <ContextMenuTrigger asChild>
        <FileTreeFile
          className="w-full min-w-0 cursor-pointer"
          title={entry.name}
          path={entry.path}
          name={entry.name}
          icon={getFileIcon(entry.artifact_type)}
        >
          <span className="size-4 shrink-0" />
          <span className="shrink-0">{getFileIcon(entry.artifact_type)}</span>
          <span
            className={cn(
              "flex min-w-0 flex-1 items-center gap-1",
              ARTIFACT_TREE_FILE_NAME_MAX_W
            )}
            title={entry.name}
          >
            <span className="min-w-0 truncate">{entry.name}</span>
            {isPendingStreaming && (
              <span className="inline-flex shrink-0 items-center gap-0.5 text-[10px] text-muted-foreground">
                <IconLoader className="size-3 animate-spin" />
                写入中
              </span>
            )}
          </span>
        </FileTreeFile>
      </ContextMenuTrigger>
      <ResourceContextMenu
        entry={entry}
        conversationId={conversationId}
        onDelete={onDelete}
        onRefresh={onRefresh}
        pendingOnly={isPendingStreaming}
      />
    </ContextMenu>
  )
}

export const ArtifactPanel = ({
  conversationId,
  isOpen,
  onClose,
  className,
  presentation = "slide-over",
}: ArtifactPanelProps) => {
  const [selectedPath, setSelectedPath] = React.useState<string | null>(null)
  const [expandedPaths, setExpandedPaths] = React.useState<Set<string>>(
    () => new Set()
  )
  const [searchQuery, setSearchQuery] = React.useState("")
  const [importDraftSkillEntry, setImportDraftSkillEntry] =
    React.useState<ResourceEntry | null>(null)
  const activeResourcePath = useArtifactStore((s) => s.activeResourcePath)
  const clearPendingResource = useArtifactStore((s) => s.clearPendingResource)
  const pendingList = useArtifactStore(
    useShallow((s) => {
      if (!conversationId) return EMPTY_PENDING_LIST
      const map = s.pendingByConversation.get(String(conversationId))
      return map ? Array.from(map.values()) : EMPTY_PENDING_LIST
    })
  )

  const getPendingForPath = React.useCallback(
    (path: string) => findPendingByPath(pendingList, path),
    [pendingList]
  )

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
  const apiResources = resourceList ?? EMPTY_RESOURCE_LIST
  const resources = React.useMemo(
    () => mergePendingIntoResourceList(apiResources, pendingList),
    [apiResources, pendingList]
  )
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
    () =>
      countFiles(resources.artifacts) +
      countFiles(resources.uploads) +
      countFiles(resources.skills_draft),
    [resources.artifacts, resources.uploads, resources.skills_draft]
  )

  React.useEffect(() => {
    if (!conversationId || !resourceList) return
    for (const pending of pendingList) {
      const existsOnDisk = findEntryByPath(
        [
          ...resourceList.artifacts,
          ...resourceList.uploads,
          ...resourceList.skills_draft,
        ],
        pending.path
      )
      if (existsOnDisk) {
        clearPendingResource(conversationId, pending.path)
      }
    }
  }, [clearPendingResource, conversationId, pendingList, resourceList])
  const filteredFiles = React.useMemo(
    () =>
      countFiles(filteredArtifacts) +
      countFiles(filteredUploads) +
      countFiles(filteredSkillsDraft),
    [filteredArtifacts, filteredUploads, filteredSkillsDraft]
  )
  const hasResources = totalFiles > 0
  const hasSearchQuery = searchQuery.trim().length > 0
  const hasFilteredResources =
    hasEntries(filteredArtifacts) ||
    hasEntries(filteredUploads) ||
    hasEntries(filteredSkillsDraft)

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
    if (!selectedPath) return null
    const fromMerged = findEntryByPath(
      [
        ...resources.artifacts,
        ...resources.uploads,
        ...resources.skills_draft,
      ],
      selectedPath
    )
    if (fromMerged) return fromMerged
    const pending = findPendingByPath(pendingList, selectedPath)
    return pending ? pendingToResourceEntry(pending) : null
  }, [pendingList, resources, selectedPath])

  const selectedFilePath =
    selectedEntry?.entry_type === "file" ? selectedEntry.path : null

  const selectedPending = findPendingByPath(pendingList, selectedFilePath)

  const isDocFile = isDocumentFile(selectedFilePath)
  const isPendingDocStreaming =
    isDocFile && selectedPending?.isStreaming === true

  const skipApiContentFetch =
    !!selectedPending &&
    !isDocFile &&
    selectedPending.isStreaming === true

  const { data: resourceContent } = useResourceContentQuery(
    conversationId!,
    isDocFile || skipApiContentFetch ? null : selectedFilePath
  )

  const shouldUsePendingContent =
    !!selectedPending &&
    !isDocFile &&
    (selectedPending.isStreaming || !resourceContent)

  const artifactForRenderer = React.useMemo((): Artifact | null => {
    if (isPendingDocStreaming) return null
    if (shouldUsePendingContent && selectedPending && selectedFilePath) {
      return {
        id: `pending:${selectedFilePath}`,
        type: (selectedEntry?.artifact_type as Artifact["type"]) || "text",
        title: selectedEntry?.name ?? selectedFilePath.split("/").pop() ?? "file",
        content: selectedPending.content,
        language: detectLanguage(selectedFilePath) ?? undefined,
      }
    }
    if (isDocFile && selectedEntry && conversationId) {
      return {
        id: `resource:${selectedPath}`,
        type: "document",
        title: selectedEntry.name,
        content: "",
        metadata: { conversationId, resourcePath: selectedPath ?? undefined },
      }
    }
    if (!resourceContent) return null
    return {
      id: `resource:${selectedPath}`,
      type: (resourceContent.artifact_type as Artifact["type"]) || "text",
      title: selectedPath?.split("/").pop() ?? "file",
      content: resourceContent.content,
      language: resourceContent.language ?? undefined,
    }
  }, [
    conversationId,
    isDocFile,
    isPendingDocStreaming,
    resourceContent,
    selectedEntry,
    selectedFilePath,
    selectedPath,
    selectedPending,
    shouldUsePendingContent,
  ])

  const Renderer = artifactForRenderer
    ? resolveArtifactRenderer(artifactForRenderer, selectedFilePath)
    : null
  const selectedFileSize = formatFileSize(selectedEntry?.size)
  const selectedTypeLabel = getArtifactTypeLabel(
    isDocumentFile(selectedEntry?.path)
      ? "document"
      : selectedEntry?.artifact_type,
    selectedFilePath
  )

  const handleCopy = async () => {
    if (artifactForRenderer) {
      await navigator.clipboard.writeText(artifactForRenderer.content)
    }
  }

  const handleDownload = async () => {
    if (!conversationId || !selectedPath) return
    await downloadResource(conversationId, selectedPath)
  }

  const queryClient = useQueryClient()

  const handleRefreshResources = React.useCallback(() => {
    if (!conversationId) return
    const id = String(conversationId)
    void queryClient.invalidateQueries({ queryKey: chatKeys.resources(id) })
    if (selectedFilePath) {
      void queryClient.invalidateQueries({
        queryKey: chatKeys.resourceContent(id, selectedFilePath),
      })
    }
  }, [conversationId, queryClient, selectedFilePath])

  const handleDelete = async (entry: ResourceEntry) => {
    if (!conversationId) return
    try {
      await deleteResource(conversationId, entry.path)
      toast.success(`已删除 ${entry.name}`)
      if (selectedPath === entry.path) {
        setSelectedPath(null)
      }
      queryClient.invalidateQueries({
        queryKey: chatKeys.resources(String(conversationId)),
      })
    } catch {
      toast.error(`删除失败`)
    }
  }

  const handleImportSkill = React.useCallback((entry: ResourceEntry) => {
    setImportDraftSkillEntry(entry)
  }, [])

  const panelShellClass = cn(
    "flex h-full min-w-0 flex-col overflow-hidden rounded-lg border bg-background shadow-xl",
    presentation === "embedded" && "rounded-none border-0 shadow-none",
    className
  )

  const panelBody = (
    <>
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
          {selectedEntry && !selectedPending?.isStreaming && (
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
              <IconSearch className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
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
                  <FileTreeFolder
                    className={ARTIFACT_TREE_NAME_ROW_CLASS}
                    path="/artifacts"
                    name="产物"
                    title="artifacts"
                  >
                    {filteredArtifacts.map((e) =>
                      renderEntry(
                        e,
                        conversationId!,
                        handleDelete,
                        handleRefreshResources,
                        getPendingForPath
                      )
                    )}
                  </FileTreeFolder>
                )}
                {filteredUploads.length > 0 && (
                  <FileTreeFolder
                    className={ARTIFACT_TREE_NAME_ROW_CLASS}
                    path="/uploads"
                    name="上传文件"
                    title="uploads"
                  >
                    {filteredUploads.map((e) =>
                      renderEntry(
                        e,
                        conversationId!,
                        handleDelete,
                        handleRefreshResources,
                        getPendingForPath
                      )
                    )}
                  </FileTreeFolder>
                )}
                {filteredSkillsDraft.length > 0 && (
                  <FileTreeFolder
                    className={ARTIFACT_TREE_NAME_ROW_CLASS}
                    path="/skills-draft"
                    name="技能草稿"
                    title="skills-draft"
                  >
                    {filteredSkillsDraft.map((skill) => (
                      <ContextMenu key={skill.path}>
                        <ContextMenuTrigger asChild>
                          <div>
                            <FileTreeFolder
                              className={ARTIFACT_TREE_NAME_ROW_CLASS}
                              path={skill.path}
                              name={skill.name}
                              title={skill.name}
                            >
                              <span className="flex items-center gap-1">
                                <IconSparkles className="size-3 text-amber-500" />
                              </span>
                              {skill.children?.map((e) =>
                                renderEntry(
                                  e,
                                  conversationId!,
                                  handleDelete,
                                  handleRefreshResources,
                                  getPendingForPath
                                )
                              )}
                            </FileTreeFolder>
                          </div>
                        </ContextMenuTrigger>
                        <SkillDraftContextMenu
                          entry={skill}
                          conversationId={conversationId!}
                          onDelete={handleDelete}
                          onRefresh={handleRefreshResources}
                          onImport={handleImportSkill}
                        />
                      </ContextMenu>
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
                  {hasSearchQuery ? "换个关键词试试" : "产物文件会在这里展示"}
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
                <h3
                  className={cn(
                    "min-w-0 truncate text-sm font-medium",
                    ARTIFACT_DETAIL_NAME_MAX_W
                  )}
                  title={selectedEntry?.name ? selectedEntry.name : undefined}
                >
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
                    <span
                      className="min-w-0 flex-1 truncate"
                      title={selectedEntry.path}
                    >
                      {selectedEntry.path}
                    </span>
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
                  {isPendingDocStreaming
                    ? "文件写入中，完成后可预览"
                    : selectedEntry?.entry_type === "directory"
                      ? "这是一个文件夹"
                      : selectedPending?.isStreaming
                        ? "正在写入文件…"
                        : "选择文件查看内容"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground/80">
                  {isPendingDocStreaming
                    ? "Office / PDF 等文档需落盘后才能预览"
                    : selectedEntry?.entry_type === "directory"
                      ? "展开左侧目录并选择具体文件进行预览"
                      : selectedPending?.isStreaming
                        ? "内容将随工具输出实时更新"
                        : "可在左侧搜索或浏览资源文件"}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )

  return (
    <>
      {presentation === "embedded" ? (
        isOpen ? (
          <div className={panelShellClass}>{panelBody}</div>
        ) : null
      ) : (
        <AnimatePresence>
          {isOpen && (
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className={panelShellClass}
            >
              {panelBody}
            </motion.div>
          )}
        </AnimatePresence>
      )}
      {importDraftSkillEntry && conversationId && (
        <ImportDraftSkillDialog
          open={!!importDraftSkillEntry}
          onOpenChange={(open) => {
            if (!open) setImportDraftSkillEntry(null)
          }}
          onSuccess={handleRefreshResources}
          conversationId={conversationId}
          skillPath={importDraftSkillEntry.path}
          skillName={importDraftSkillEntry.name}
        />
      )}
    </>
  )
}
