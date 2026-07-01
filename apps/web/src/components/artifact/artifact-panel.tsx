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
  IconSparkles,
  IconRefresh,
  IconSearch,
  IconTrash,
  IconFileImport,
  IconLoader,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconArrowLeft,
  IconListDetails,
  IconPin,
  IconFolderOpen,
} from "@tabler/icons-react"
import { useLocalStorageState } from "ahooks"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@workspace/ui/components/context-menu"
import { cn } from "@workspace/ui/lib/utils"
import type { ResourceEntry } from "@/api/types"
import {
  useConversationResourcesQuery,
  useResourceContentQuery,
} from "@/hooks/use-chat-queries"
import { deleteResource, downloadResource } from "@/api/chat"
import { useQueryClient } from "@tanstack/react-query"
import { chatKeys } from "@/lib/query-keys/chat"
import { getFileIcon as getFileIconUrl } from "@/lib/chat/file-icons"
import { detectLanguage } from "@/components/chat/shared/code-highlight"
import {
  findPendingByPath,
  getPendingPreviewState,
  isDocumentPath,
  RESOURCE_TREE_ROOTS,
  useConversationPendingResources,
  type PendingResource,
} from "@/lib/chat/pending-resources"
import { useArtifactStore } from "@/stores/artifact-store"
import { toast } from "sonner"
import { ArtifactPreviewStreamingPlaceholder } from "./artifact-content/artifact-preview-streaming-placeholder"
import { ArtifactStreamingTextPreview } from "./artifact-content/artifact-streaming-text-preview"
import { ArtifactRendererView } from "./artifact-content/artifact-renderer-view"
import {
  getPreviewableTypeLabel,
  isHtmlPath,
} from "./artifact-content/resolve-renderer"
import {
  addHtmlTab,
  emitWorkbenchConfigChanged,
} from "@/lib/workbench/workbench-config"
import { fetchWorkbench, saveWorkbench } from "@/api/workbench"
import type { Artifact } from "./artifact-types"
import { ImportDraftSkillDialog } from "./import-draft-skill-dialog"
import { SubConversationPanel } from "./sub-conversation-panel"
import { isElectron, withElectronApi } from "@/lib/electron/host"

export interface ArtifactPanelProps {
  conversationId: string | number | null
  isOpen: boolean
  onClose: () => void
  className?: string
  /** embedded：置于 Sheet 等容器内，不使用侧滑入场动画 */
  presentation?: "slide-over" | "embedded"
}

/** 侧栏树内文件名/文件夹名展示宽度；完整名见原生 title */
const ARTIFACT_TREE_NAME_ROW_CLASS =
  "[&_button.min-w-0.flex-1>span:last-child]:max-w-[11rem]"
const ARTIFACT_TREE_FILE_NAME_MAX_W = "max-w-[11rem]"
/** 预览区标题栏文件名 */
const ARTIFACT_DETAIL_NAME_MAX_W = "max-w-[min(100%,22rem)]"
const RESOURCE_EXPLORER_OPEN_STORAGE_KEY = "artifact:resource-explorer:open"

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

// 按真实文件名解析 Material 文件类型图标（覆盖数百种扩展名）。
// 传文件名/路径而非粗粒度 artifact_type，故 .ts/.py/.json/.zip… 各有其图标。
function getFileIcon(filename: string | null | undefined) {
  const url = filename ? getFileIconUrl(filename) : ""
  if (!url) return <IconFile className="size-4 text-muted-foreground" />
  return <img src={url} alt="" aria-hidden className="size-4 shrink-0" />
}

function toNativeAbsPath(p: string): string {
  // Windows 盘符路径转反斜杠展示；POSIX 路径保持正斜杠
  return /^[A-Za-z]:/.test(p) ? p.replace(/\//g, "\\") : p
}

async function copyTextToClipboard(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(`已复制${label}`)
  } catch {
    toast.error("复制失败")
  }
}

function CopyPathMenuItems({ entry }: { entry: ResourceEntry }) {
  return (
    <>
      <ContextMenuItem
        onSelect={() =>
          copyTextToClipboard(toNativeAbsPath(entry.path), "绝对路径")
        }
      >
        <IconCopy className="size-4 text-muted-foreground" />
        <span>复制绝对路径</span>
      </ContextMenuItem>
      {entry.rel_path ? (
        <ContextMenuItem
          onSelect={() => copyTextToClipboard(entry.rel_path!, "相对路径")}
        >
          <IconCopy className="size-4 text-muted-foreground" />
          <span>复制相对路径</span>
        </ContextMenuItem>
      ) : null}
    </>
  )
}

function revealResourceInExplorer(entry: ResourceEntry) {
  void withElectronApi(
    (api) => api.revealPathInExplorer(entry.path, entry.entry_type),
    {
      onError: (error) => {
        toast.error(
          error instanceof Error ? error.message : "无法在本机打开"
        )
      },
    }
  )
}

function ResourceContextMenu({
  entry,
  conversationId,
  onDelete,
  onRefresh,
  onPin,
  pendingOnly = false,
}: {
  entry: ResourceEntry
  conversationId: string | number
  onDelete: (entry: ResourceEntry) => void
  onRefresh: () => void
  onPin?: (entry: ResourceEntry) => void
  pendingOnly?: boolean
}) {
  const handleDownload = async () => {
    await downloadResource(conversationId, entry.path)
  }

  return (
    <ContextMenuContent className="w-44">
      {!pendingOnly && (
        <ContextMenuItem onSelect={handleDownload}>
          <IconDownload className="size-4 text-muted-foreground" />
          <span>下载</span>
        </ContextMenuItem>
      )}
      {isElectron() && !pendingOnly && (
        <ContextMenuItem onSelect={() => revealResourceInExplorer(entry)}>
          <IconFolderOpen className="size-4 text-muted-foreground" />
          <span>
            {entry.entry_type === "file" ? "在文件夹中显示" : "在本机打开"}
          </span>
        </ContextMenuItem>
      )}
      {!pendingOnly && onPin && isHtmlPath(entry.path) && (
        <ContextMenuItem onSelect={() => onPin(entry)}>
          <IconPin className="size-4 text-muted-foreground" />
          <span>钉到工作台</span>
        </ContextMenuItem>
      )}
      <ContextMenuSeparator />
      <CopyPathMenuItems entry={entry} />
      <ContextMenuSeparator />
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
      {isElectron() && (
        <ContextMenuItem onSelect={() => revealResourceInExplorer(entry)}>
          <IconFolderOpen className="size-4 text-muted-foreground" />
          <span>
            {entry.entry_type === "file" ? "在文件夹中显示" : "在本机打开"}
          </span>
        </ContextMenuItem>
      )}
      <ContextMenuSeparator />
      <CopyPathMenuItems entry={entry} />
      <ContextMenuSeparator />
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

/** 把某会话的 HTML 产物钉成工作台全屏标签（写后端配置，并通知工作台立即刷新） */
async function pinHtmlToWorkbench(
  conversationId: string | number,
  path: string,
  name: string
) {
  const title = name.replace(/\.html?$/i, "")
  const config = await fetchWorkbench()
  const next = addHtmlTab(
    config,
    { conversationId, resourcePath: path, pinnedAt: Date.now() },
    title
  )
  await saveWorkbench(next)
  emitWorkbenchConfigChanged()
}

function renderEntry(
  entry: ResourceEntry,
  conversationId: string | number,
  onDelete: (entry: ResourceEntry) => void,
  onRefresh: () => void,
  getPendingForPath: (path: string) => PendingResource | null,
  onPin?: (entry: ResourceEntry) => void
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
                  getPendingForPath,
                  onPin
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
          icon={getFileIcon(entry.name)}
        >
          <span className="size-4 shrink-0" />
          <span className="shrink-0">{getFileIcon(entry.name)}</span>
          <span
            className={cn(
              "min-w-0 flex-1 truncate",
              ARTIFACT_TREE_FILE_NAME_MAX_W
            )}
            title={entry.name}
          >
            {entry.name}
          </span>
          {isPendingStreaming && (
            <span className="ml-auto inline-flex shrink-0 items-center gap-0.5 pl-1 text-[10px] text-muted-foreground">
              <IconLoader className="size-3 animate-spin" />
              写入中
            </span>
          )}
        </FileTreeFile>
      </ContextMenuTrigger>
      <ResourceContextMenu
        entry={entry}
        conversationId={conversationId}
        onDelete={onDelete}
        onRefresh={onRefresh}
        onPin={onPin}
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
  const [isExplorerOpen = true, setIsExplorerOpen] = useLocalStorageState<boolean>(
    RESOURCE_EXPLORER_OPEN_STORAGE_KEY,
    { defaultValue: true }
  )
  const [searchQuery, setSearchQuery] = React.useState("")
  const [importDraftSkillEntry, setImportDraftSkillEntry] =
    React.useState<ResourceEntry | null>(null)
  const activeResourcePath = useArtifactStore((s) => s.activeResourcePath)
  const activeSubConversationId = useArtifactStore((s) => s.activeSubConversationId)
  const [prevActiveResourcePath, setPrevActiveResourcePath] =
    React.useState<string | null>(null)

  if (activeResourcePath !== prevActiveResourcePath) {
    setPrevActiveResourcePath(activeResourcePath)
    if (activeResourcePath) {
      setSelectedPath(activeResourcePath)
    }
  }

  const selectionPath = selectedPath ?? activeResourcePath

  const { data: resourceList } = useConversationResourcesQuery(
    isOpen ? conversationId : null
  )
  const {
    pendingList,
    mergedResources: resources,
    getPendingForPath,
    resolveEntryForPath,
  } = useConversationPendingResources(conversationId, resourceList)
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
  // 员工工作空间全部（跨会话）+ 公共区（跨员工共享）
  const filteredWorkspace = React.useMemo(
    () => filterEntries(resources.workspace ?? [], searchQuery),
    [resources.workspace, searchQuery]
  )
  const filteredPublic = React.useMemo(
    () => filterEntries(resources.public ?? [], searchQuery),
    [resources.public, searchQuery]
  )
  const totalFiles = React.useMemo(
    () =>
      countFiles(resources.artifacts) +
      countFiles(resources.uploads) +
      countFiles(resources.skills_draft),
    [resources.artifacts, resources.uploads, resources.skills_draft]
  )

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
    hasEntries(filteredSkillsDraft) ||
    hasEntries(filteredWorkspace) ||
    hasEntries(filteredPublic)

  const searchExpandedPaths = React.useMemo(() => {
    if (!hasSearchQuery) return null

    const next = new Set<string>()
    for (const root of RESOURCE_TREE_ROOTS) {
      const key = root.listKey
      const hasBucket =
        (key === "artifacts" && filteredArtifacts.length > 0) ||
        (key === "uploads" && filteredUploads.length > 0) ||
        (key === "skills_draft" && filteredSkillsDraft.length > 0)
      if (hasBucket) next.add(root.path)
    }
    for (const path of collectDirectoryPaths([
      ...filteredArtifacts,
      ...filteredUploads,
      ...filteredSkillsDraft,
    ])) {
      next.add(path)
    }
    return next
  }, [
    filteredArtifacts,
    filteredSkillsDraft,
    filteredUploads,
    hasSearchQuery,
  ])

  // 首次加载该会话的资源后，自动展开有内容的桶根目录（工作空间产物默认展开可见，
  // 含 app 托管与外部 flat 工作空间）。每会话只做一次，之后不覆盖用户手动折叠。
  const initialExpandConvRef = React.useRef<string | number | null>(null)
  React.useEffect(() => {
    if (hasSearchQuery || conversationId == null || !resourceList) return
    if (initialExpandConvRef.current === conversationId) return
    initialExpandConvRef.current = conversationId
    setExpandedPaths((prev) => {
      const next = new Set(prev)
      for (const root of RESOURCE_TREE_ROOTS) {
        const list =
          root.listKey === "artifacts"
            ? resources.artifacts
            : root.listKey === "uploads"
              ? resources.uploads
              : resources.skills_draft
        if (hasEntries(list)) next.add(root.path)
      }
      return next
    })
  }, [
    conversationId,
    hasSearchQuery,
    resourceList,
    resources.artifacts,
    resources.uploads,
    resources.skills_draft,
  ])

  React.useEffect(() => {
    if (!selectionPath) return
    setExpandedPaths((prev) => {
      const next = new Set(prev)
      let changed = false
      for (const path of getParentPaths(selectionPath)) {
        if (!next.has(path)) {
          next.add(path)
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [selectionPath])

  React.useEffect(() => {
    if (!searchExpandedPaths) return
    setExpandedPaths((prev) => {
      const next = new Set(prev)
      let changed = false
      for (const path of searchExpandedPaths) {
        if (!next.has(path)) {
          next.add(path)
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [searchExpandedPaths])

  const selectedEntry = React.useMemo(
    () => resolveEntryForPath(selectionPath),
    [resolveEntryForPath, selectionPath]
  )

  const selectedFilePath =
    selectedEntry?.entry_type === "file" ? selectedEntry.path : null

  const selectedPending = findPendingByPath(pendingList, selectedFilePath)

  const isDocFile = isDocumentPath(selectedFilePath)

  const { data: resourceContent } = useResourceContentQuery(
    conversationId!,
    selectedPending?.isStreaming ? null : selectedFilePath
  )

  const previewStateWithContent = React.useMemo(
    () =>
      getPendingPreviewState(
        selectedPending,
        selectedFilePath,
        !!resourceContent,
        selectedEntry?.artifact_type
      ),
    [resourceContent, selectedEntry?.artifact_type, selectedFilePath, selectedPending]
  )

  const artifactForRenderer = React.useMemo((): Artifact | null => {
    if (previewStateWithContent.showStreamingPlaceholder) return null
    if (
      previewStateWithContent.shouldUsePendingContent &&
      selectedPending &&
      selectedFilePath
    ) {
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
        id: `resource:${selectionPath}`,
        type: "document",
        title: selectedEntry.name,
        content: "",
        metadata: { conversationId, resourcePath: selectionPath ?? undefined },
      }
    }
    if (!resourceContent) return null
    return {
      id: `resource:${selectionPath}`,
      type: (resourceContent.artifact_type as Artifact["type"]) || "text",
      title: selectionPath?.split("/").pop() ?? "file",
      content: resourceContent.content,
      language: resourceContent.language ?? undefined,
    }
  }, [
    conversationId,
    isDocFile,
    previewStateWithContent.showStreamingPlaceholder,
    previewStateWithContent.shouldUsePendingContent,
    resourceContent,
    selectedEntry,
    selectedFilePath,
    selectionPath,
    selectedPending,
  ])

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
    if (!conversationId || !selectionPath) return
    await downloadResource(conversationId, selectionPath)
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
      if (selectionPath === entry.path) {
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

  const handlePin = React.useCallback(
    (entry: ResourceEntry) => {
      if (!conversationId) return
      void pinHtmlToWorkbench(conversationId, entry.path, entry.name)
        .then(() =>
          toast.success(`已钉到工作台：${entry.name.replace(/\.html?$/i, "")}`)
        )
        .catch(() => toast.error("钉到工作台失败"))
    },
    [conversationId]
  )

  const panelShellClass = cn(
    "flex h-full min-w-0 flex-col overflow-hidden rounded-lg border bg-background shadow-xl",
    presentation === "embedded" && "rounded-none border-0 shadow-none",
    className
  )

  if (activeSubConversationId != null) {
    const subConvBody = (
      <>
        <div className="flex min-w-0 items-center gap-2 border-b px-4 py-3">
          <button
            type="button"
            onClick={() => useArtifactStore.getState().closeArtifact()}
            className="flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="返回资源管理器"
          >
            <IconArrowLeft className="size-4" />
          </button>
          <IconListDetails className="size-4 shrink-0 text-muted-foreground" />
          <h2 className="min-w-0 flex-1 truncate text-sm font-medium">执行详情</h2>
          <button
            type="button"
            onClick={onClose}
            className="flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="关闭"
          >
            <IconX className="size-4" />
          </button>
        </div>
        <SubConversationPanel conversationId={activeSubConversationId} />
      </>
    )

    return (
      <>
        {presentation === "embedded" ? (
          isOpen ? (
            <div className={panelShellClass}>{subConvBody}</div>
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
                {subConvBody}
              </motion.div>
            )}
          </AnimatePresence>
        )}
      </>
    )
  }

  const panelBody = (
    <>
      <div className="flex min-w-0 items-center justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <h2 className="text-sm font-medium">资源管理器</h2>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    aria-label={isExplorerOpen ? "收起文件树" : "展开文件树"}
                    className="-ml-1 size-7 shrink-0 p-0 text-muted-foreground hover:text-foreground"
                    size="sm"
                    variant="ghost"
                    onClick={() => setIsExplorerOpen(!isExplorerOpen)}
                  >
                    {isExplorerOpen ? (
                      <IconLayoutSidebarLeftCollapse className="size-4" />
                    ) : (
                      <IconLayoutSidebarLeftExpand className="size-4" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {isExplorerOpen ? "收起文件树" : "展开文件树"}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <p className="mt-0.5 truncate pl-6 text-xs text-muted-foreground">
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
        {isExplorerOpen ? (
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
                  selectedPath={selectionPath ?? undefined}
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
                          getPendingForPath,
                          handlePin
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
                          getPendingForPath,
                          handlePin
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
                                    getPendingForPath,
                                    handlePin
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
                  {filteredWorkspace.length > 0 && (
                    <FileTreeFolder
                      className={ARTIFACT_TREE_NAME_ROW_CLASS}
                      path="/workspace"
                      name="工作空间（全部会话）"
                      title="workspace"
                    >
                      {filteredWorkspace.map((e) =>
                        renderEntry(
                          e,
                          conversationId!,
                          handleDelete,
                          handleRefreshResources,
                          getPendingForPath,
                          handlePin
                        )
                      )}
                    </FileTreeFolder>
                  )}
                  {filteredPublic.length > 0 && (
                    <FileTreeFolder
                      className={ARTIFACT_TREE_NAME_ROW_CLASS}
                      path="/public"
                      name="公共区（跨员工共享）"
                      title="public"
                    >
                      {filteredPublic.map((e) =>
                        renderEntry(
                          e,
                          conversationId!,
                          handleDelete,
                          handleRefreshResources,
                          getPendingForPath,
                          handlePin
                        )
                      )}
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
        ) : null}

        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex min-w-0 items-center justify-between gap-3 border-b bg-background/95 px-4 py-3">
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                {selectedEntry && getFileIcon(selectedEntry.name)}
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
          {previewStateWithContent.showStreamingPlaceholder ? (
            <ArtifactPreviewStreamingPlaceholder
              kind={previewStateWithContent.rendererKind}
              className="min-h-0 min-w-0 flex-1"
            />
          ) : previewStateWithContent.shouldUsePendingContent &&
            selectedPending?.isStreaming ? (
            <ArtifactStreamingTextPreview
              content={selectedPending.content}
              className="min-h-0 min-w-0 flex-1"
            />
          ) : artifactForRenderer ? (
            <ArtifactRendererView
              artifact={artifactForRenderer}
              filePath={selectedFilePath}
              conversationId={conversationId}
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
                    ? "展开文件树并选择具体文件进行预览"
                    : isExplorerOpen
                      ? "可在左侧搜索或浏览资源文件"
                      : "点击标题栏左侧按钮展开文件树"}
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
