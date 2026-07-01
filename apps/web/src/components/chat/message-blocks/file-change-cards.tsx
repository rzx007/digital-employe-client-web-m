import * as React from "react"
import { cn } from "@workspace/ui/lib/utils"
import {
  IconChevronDown,
  IconChevronRight,
  IconDownload,
  IconWorld,
} from "@tabler/icons-react"

import folderIcon from "@/assets/files/fold.png"
import plainIcon from "@/assets/files/plain_dark.png"
import { downloadResource } from "@/api/chat"
import type { ResourceEntry, ResourceList } from "@/api/types"
import { isHtmlPath } from "@/components/artifact/artifact-content/resolve-renderer"
import { useCuratorFile } from "@/components/chat/curator/use-curator-file"
import { useConversationResourcesQuery } from "@/hooks/use-chat-queries"
import type { FileChangeItem } from "@/lib/chat/file-change-utils"
import { getFileIcon } from "@/lib/chat/file-icons"
import { useArtifactStore } from "@/stores/artifact-store"
import { useBrowserStore } from "@/stores/browser-store"
import { useChatStore } from "@/stores/chat-store"
import { resolveFileOpen } from "./file-open-routing"

const FILE_SCROLL_THRESHOLD = 4
const FILE_COLLAPSE_THRESHOLD = 8
const FILE_COLLAPSED_COUNT = 4

/** 随 Curator / 对话区容器宽度响应（可 resize，不用 compact 布尔） */
const CARD_SHELL =
  "@container/file-changes not-prose relative w-full min-w-0 max-w-full self-start rounded-lg border border-border/50 bg-muted/30 px-2 py-1.5 @[28rem]/file-changes:max-w-2xl @[28rem]/file-changes:px-3 @[28rem]/file-changes:py-2"

const FILE_GRID = "grid grid-cols-1 gap-2 @[28rem]/file-changes:grid-cols-2"

const FILE_ROW =
  "group relative flex min-w-0 cursor-pointer items-start gap-2 rounded-md border border-border/50 bg-background/70 px-2 py-1.5 text-left transition-colors hover:bg-background @[28rem]/file-changes:items-center @[28rem]/file-changes:gap-3 @[28rem]/file-changes:px-3 @[28rem]/file-changes:py-2"

interface FileChangeCardsProps {
  files: FileChangeItem[]
  className?: string
  /** 头部标签；默认「本轮文件变更」，总管交付物聚合可传「团队交付物」。 */
  title?: string
  /**
   * true=files 来自 file_outputs 权威来源 → 与会话资源树求交集，已删/空文件不显示。
   * false（默认）=parts 流式兜底或外部聚合（团队交付物）→ 不做交集过滤，保即时反馈。
   */
  authoritative?: boolean
}

/** Windows 盘符大小写差异 + 反斜杠：统一正斜杠并小写化便于不区分大小写比较。 */
function normalizePathForMatch(path: string): string {
  return path.replace(/\\/g, "/").toLowerCase()
}

/** 收集资源树里所有 file 条目的可匹配路径（path / rel_path 两套都收，便于命中）。 */
function collectResourceFilePaths(list: ResourceList | undefined): Set<string> {
  const paths = new Set<string>()
  if (!list) return paths
  const visit = (entries: ResourceEntry[] | null | undefined) => {
    if (!entries) return
    for (const entry of entries) {
      if (entry.entry_type === "file") {
        if (entry.path) paths.add(normalizePathForMatch(entry.path))
        if (entry.rel_path) paths.add(normalizePathForMatch(entry.rel_path))
      }
      if (entry.children) visit(entry.children)
    }
  }
  // 交付物桶（产物 / 草稿技能）已覆盖 FileChangeCards 可见的所有桶；uploads 一并收无害。
  visit(list.artifacts)
  visit(list.uploads)
  visit(list.skills_draft)
  visit(list.workspace)
  visit(list.public)
  return paths
}

function getIcon(file: FileChangeItem) {
  if (file.kind === "skill-folder") {
    return folderIcon
  }

  const filename = file.extension ? `file.${file.extension}` : "file"
  return getFileIcon(filename) || plainIcon
}

function getActionLabel(file: FileChangeItem) {
  if (file.kind === "skill-folder") {
    return file.action === "created" ? "已创建技能" : "已编辑技能"
  }

  return file.action === "created" ? "已创建" : "已编辑"
}

function formatSize(size: number | undefined) {
  if (size === undefined) {
    return null
  }

  if (size < 1024) {
    return `${size} 字符`
  }

  return `${(size / 1024).toFixed(1)}k 字符`
}

function basename(path: string) {
  const parts = path.split(/[/\\]/)
  return parts[parts.length - 1] || path
}

function FileChangeCardRow({
  file,
  conversationId,
  dim = false,
  onOpen,
  onDownload,
  onPreview,
}: {
  file: FileChangeItem
  conversationId: string | number | null
  /** 中间产物（脚本/依赖）以更弱的视觉呈现 */
  dim?: boolean
  onOpen: (path: string) => void
  onDownload: (file: FileChangeItem) => void
  onPreview?: (path: string) => void
}) {
  const size = formatSize(file.size)
  const pathBasename = basename(file.path)
  const canPreviewHtml = isHtmlPath(file.path) && onPreview != null

  const actionButtons = conversationId != null && (
    <div
      className={cn(
        "flex shrink-0 items-center gap-0.5",
        "@[28rem]/file-changes:absolute @[28rem]/file-changes:top-1.5 @[28rem]/file-changes:right-1.5",
        "@[28rem]/file-changes:opacity-0 @[28rem]/file-changes:transition-opacity @[28rem]/file-changes:group-hover:opacity-100"
      )}
    >
      {canPreviewHtml ? (
        <button
          type="button"
          className="flex size-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={(e) => {
            e.stopPropagation()
            onPreview?.(file.path)
          }}
          aria-label="在内置浏览器查看"
          title="在内置浏览器查看"
        >
          <IconWorld className="size-3.5" />
        </button>
      ) : null}
      <button
        type="button"
        className="flex size-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        onClick={(e) => {
          e.stopPropagation()
          onDownload(file)
        }}
        aria-label="下载"
      >
        <IconDownload className="size-3.5" />
      </button>
    </div>
  )

  return (
    <div
      className={cn(FILE_ROW, dim && "opacity-70 hover:opacity-100")}
      onClick={() => onOpen(file.path)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter") onOpen(file.path)
      }}
    >
      <img
        alt=""
        aria-hidden="true"
        className={cn(
          "size-6 shrink-0 @[28rem]/file-changes:size-8",
          dim && "grayscale"
        )}
        draggable={false}
        src={getIcon(file)}
      />
      <div className="min-w-0 flex-1 overflow-hidden">
        <div className="flex min-w-0 flex-col gap-0.5 @[28rem]/file-changes:flex-row @[28rem]/file-changes:items-center @[28rem]/file-changes:gap-2">
          <span
            className="truncate text-xs font-medium text-foreground @[28rem]/file-changes:text-sm"
            title={file.title}
          >
            {file.title}
          </span>
          <span className="w-fit shrink-0 rounded-full bg-muted px-1 py-0 text-[9px] text-muted-foreground @[28rem]/file-changes:px-1.5 @[28rem]/file-changes:py-0.5 @[28rem]/file-changes:text-[10px]">
            {getActionLabel(file)}
          </span>
        </div>
        <div className="mt-0 flex min-w-0 items-center gap-2 text-[10px] text-muted-foreground @[28rem]/file-changes:mt-0.5 @[28rem]/file-changes:text-[11px]">
          <span
            className="truncate @[28rem]/file-changes:hidden"
            title={file.path}
          >
            {pathBasename}
          </span>
          <span
            className="hidden truncate @[28rem]/file-changes:inline"
            title={file.path}
          >
            {file.path}
          </span>
          {size && <span className="shrink-0">{size}</span>}
        </div>
      </div>
      {actionButtons}
    </div>
  )
}

function FileListScrollFog() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-8 bg-gradient-to-t from-muted/80 via-muted/30 to-transparent"
    />
  )
}

interface FileRowHandlers {
  conversationId: string | number | null
  onOpen: (path: string) => void
  onDownload: (file: FileChangeItem) => void
  onPreview?: (path: string) => void
}

/** 一段文件列表：含 grid 布局、滚动雾化、超阈值折叠/展开。交付物与脚本两段各用一个。 */
function FileGridList({
  files,
  dim = false,
  handlers,
}: {
  files: FileChangeItem[]
  dim?: boolean
  handlers: FileRowHandlers
}) {
  const signature = React.useMemo(
    () => files.map((f) => f.id).join("\0"),
    [files]
  )
  const [expandedOverride, setExpandedOverride] = React.useState<{
    signature: string
    value: boolean
  } | null>(null)

  const defaultExpanded = files.length <= FILE_COLLAPSE_THRESHOLD
  const expanded =
    expandedOverride?.signature === signature
      ? expandedOverride.value
      : defaultExpanded

  if (files.length === 0) {
    return null
  }

  const displayFiles = expanded ? files : files.slice(0, FILE_COLLAPSED_COUNT)
  const needsScroll =
    files.length > FILE_SCROLL_THRESHOLD &&
    (expanded || files.length <= FILE_COLLAPSE_THRESHOLD)
  const canCollapse = files.length > FILE_COLLAPSE_THRESHOLD
  const showExpand = canCollapse && !expanded

  return (
    <>
      <div className="relative">
        <div
          className={cn(
            FILE_GRID,
            needsScroll &&
              "max-h-64 overflow-y-auto overscroll-y-contain pr-0.5"
          )}
        >
          {displayFiles.map((file) => (
            <FileChangeCardRow
              key={file.id}
              file={file}
              dim={dim}
              conversationId={handlers.conversationId}
              onOpen={handlers.onOpen}
              onDownload={handlers.onDownload}
              onPreview={handlers.onPreview}
            />
          ))}
        </div>
        {needsScroll && <FileListScrollFog />}
      </div>

      {showExpand && (
        <button
          type="button"
          className="mt-2 w-full text-left text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          onClick={() => setExpandedOverride({ signature, value: true })}
        >
          查看全部 {files.length} 个文件
        </button>
      )}
      {canCollapse && expanded && (
        <button
          type="button"
          className="mt-2 w-full text-left text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          onClick={() => setExpandedOverride({ signature, value: false })}
        >
          收起
        </button>
      )}
    </>
  )
}

/** 次级区：生成交付物用的脚本/依赖，默认折叠，弱化展示。 */
function IntermediateSection({
  files,
  handlers,
}: {
  files: FileChangeItem[]
  handlers: FileRowHandlers
}) {
  const [open, setOpen] = React.useState(false)

  if (files.length === 0) {
    return null
  }

  return (
    <div className="mt-2 border-t border-border/40 pt-2">
      <button
        type="button"
        className="flex w-full items-center gap-1 text-left text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? (
          <IconChevronDown className="size-3.5 shrink-0" />
        ) : (
          <IconChevronRight className="size-3.5 shrink-0" />
        )}
        <span>{files.length} 个生成脚本 / 依赖</span>
      </button>
      {open && (
        <div className="mt-2">
          <FileGridList files={files} dim handlers={handlers} />
        </div>
      )}
    </div>
  )
}

export function FileChangeCards({
  files,
  className,
  title = "本轮文件变更",
  authoritative = false,
}: FileChangeCardsProps) {
  const curatorFile = useCuratorFile()
  const openResource = useArtifactStore((s) => s.openResource)
  const openHtmlPreview = useBrowserStore((s) => s.openHtmlPreview)
  const selectedConversationId = useChatStore((s) => s.selectedConversationId)

  const conversationId = curatorFile?.conversationId ?? selectedConversationId

  // 仅权威来源（file_outputs）才与资源树求交集：已删 / 空文件不在树里 → 不显示。
  // parts 兜底 / 团队交付物聚合不拉资源树，维持现状即时反馈。
  const { data: resourceList } = useConversationResourcesQuery(
    authoritative ? conversationId : null
  )
  const visibleFiles = React.useMemo(() => {
    if (!authoritative) return files
    // 资源树尚未加载出来（流式刚结束 / 请求中）：先不过滤，避免误杀即时反馈。
    if (!resourceList) return files
    const treePaths = collectResourceFilePaths(resourceList)
    return files.filter((file) =>
      treePaths.has(normalizePathForMatch(file.path))
    )
  }, [authoritative, files, resourceList])
  const curatorOnOpenFile = curatorFile?.onOpenFile
  const handleOpen = React.useCallback(
    (path: string) => {
      if (curatorOnOpenFile) {
        curatorOnOpenFile(path)
        return
      }
      resolveFileOpen(path, {
        conversationId,
        openHtmlPreview,
        openResource,
      })
    },
    [curatorOnOpenFile, conversationId, openHtmlPreview, openResource]
  )

  const handleDownload = React.useCallback(
    async (file: FileChangeItem) => {
      if (conversationId == null) return
      await downloadResource(conversationId, file.path)
    },
    [conversationId]
  )

  const handlePreview = React.useCallback(
    (path: string) => {
      if (conversationId == null) return
      openHtmlPreview(conversationId, path)
    },
    [conversationId, openHtmlPreview]
  )

  const { deliverables, intermediates } = React.useMemo(() => {
    const deliverables: FileChangeItem[] = []
    const intermediates: FileChangeItem[] = []
    for (const file of visibleFiles) {
      if (file.category === "intermediate") {
        intermediates.push(file)
      } else {
        deliverables.push(file)
      }
    }
    return { deliverables, intermediates }
  }, [visibleFiles])

  if (visibleFiles.length === 0) {
    return null
  }

  const handlers: FileRowHandlers = {
    conversationId,
    onOpen: handleOpen,
    onDownload: handleDownload,
    onPreview: handlePreview,
  }

  // 兜底：若本轮没有交付物（全是脚本/依赖），主区直接展示这些文件，
  // 避免出现「0 交付物」的空面板。
  const hasDeliverables = deliverables.length > 0
  const mainFiles = hasDeliverables ? deliverables : intermediates
  const showIntermediateSection = hasDeliverables && intermediates.length > 0

  return (
    <div className={cn(CARD_SHELL, className)}>
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[10px] font-medium text-muted-foreground @[28rem]/file-changes:text-xs">
          {title}
        </span>
        <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          {mainFiles.length}
        </span>
      </div>

      <FileGridList files={mainFiles} handlers={handlers} />

      {showIntermediateSection && (
        <IntermediateSection files={intermediates} handlers={handlers} />
      )}
    </div>
  )
}
