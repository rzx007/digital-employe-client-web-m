import * as React from "react"
import { cn } from "@workspace/ui/lib/utils"
import { IconDownload, IconPlus } from "@tabler/icons-react"

import folderIcon from "@/assets/files/fold.png"
import plainIcon from "@/assets/files/plain_dark.png"
import { ImportDraftSkillDialog } from "@/components/artifact/import-draft-skill-dialog"
import { downloadResource } from "@/api/conversation"
import type { FileChangeItem } from "@/lib/chat/file-change-utils"
import { EXTENSION_ICONS } from "@/lib/chat/file-icons"
import { useArtifactStore } from "@/stores/artifact-store"
import { useChatStore } from "@/stores/chat-store"

const FILE_SCROLL_THRESHOLD = 4
const FILE_COLLAPSE_THRESHOLD = 8
const FILE_COLLAPSED_COUNT = 4

interface FileChangeCardsProps {
  files: FileChangeItem[]
  className?: string
}

function getIcon(file: FileChangeItem) {
  if (file.kind === "skill-folder") {
    return folderIcon
  }

  return file.extension
    ? (EXTENSION_ICONS[file.extension] ?? plainIcon)
    : plainIcon
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

function FileChangeCardRow({
  file,
  conversationId,
  onOpen,
  onDownload,
  onImportSkill,
}: {
  file: FileChangeItem
  conversationId: string | null
  onOpen: (path: string) => void
  onDownload: (file: FileChangeItem) => void
  onImportSkill: (file: FileChangeItem) => void
}) {
  const size = formatSize(file.size)

  return (
    <div
      className="group relative flex min-w-0 items-center gap-3 rounded-md border border-border/50 bg-background/70 px-3 py-2 text-left transition-colors hover:bg-background"
      onClick={() => onOpen(file.path)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter") onOpen(file.path)
      }}
    >
      {conversationId && (
        <div className="absolute top-1.5 right-1.5 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          {file.kind === "skill-folder" && (
            <button
              type="button"
              className="flex size-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={(e) => {
                e.stopPropagation()
                onImportSkill(file)
              }}
              aria-label="导入到技能库"
            >
              <IconPlus className="size-3.5" />
            </button>
          )}
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
      )}
      <img
        alt=""
        aria-hidden="true"
        className="size-8 shrink-0"
        draggable={false}
        src={getIcon(file)}
      />
      <div className="min-w-0 flex-1 overflow-hidden">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="truncate text-sm font-medium text-foreground"
            title={file.title}
          >
            {file.title}
          </span>
          <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {getActionLabel(file)}
          </span>
        </div>
        <div className="mt-0.5 flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
          <span className="truncate" title={file.path}>
            {file.path}
          </span>
          {size && <span className="shrink-0">{size}</span>}
        </div>
      </div>
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

export function FileChangeCards({ files, className }: FileChangeCardsProps) {
  const openResource = useArtifactStore((s) => s.openResource)
  const conversationId = useChatStore((s) => s.selectedConversationId)

  const [importSkillFile, setImportSkillFile] =
    React.useState<FileChangeItem | null>(null)
  const [expanded, setExpanded] = React.useState(
    () => files.length <= FILE_COLLAPSE_THRESHOLD
  )

  React.useEffect(() => {
    setExpanded(files.length <= FILE_COLLAPSE_THRESHOLD)
  }, [files.length])

  const handleDownload = async (file: FileChangeItem) => {
    if (!conversationId) return
    await downloadResource(conversationId, file.path)
  }

  const handleImportSkill = React.useCallback((file: FileChangeItem) => {
    setImportSkillFile(file)
  }, [])

  if (files.length === 0) {
    return null
  }

  const displayFiles = expanded
    ? files
    : files.slice(0, FILE_COLLAPSED_COUNT)
  const needsScroll =
    files.length > FILE_SCROLL_THRESHOLD &&
    (expanded || files.length <= FILE_COLLAPSE_THRESHOLD)
  const canCollapse = files.length > FILE_COLLAPSE_THRESHOLD
  const showExpand = canCollapse && !expanded

  return (
    <>
      <div
        className={cn(
          "not-prose relative self-start w-full min-w-0 max-w-2xl rounded-lg border border-border/50 bg-muted/30 px-3 py-2",
          className
        )}
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              本轮文件变更
            </span>
            <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              {files.length}
            </span>
          </div>
          {canCollapse && expanded && (
            <button
              type="button"
              className="shrink-0 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
              onClick={() => setExpanded(false)}
            >
              收起
            </button>
          )}
        </div>

        <div className="relative">
          <div
            className={cn(
              "grid gap-2 sm:grid-cols-2",
              needsScroll &&
                "max-h-64 overflow-y-auto overscroll-y-contain pr-0.5"
            )}
          >
            {displayFiles.map((file) => (
              <FileChangeCardRow
                key={file.id}
                file={file}
                conversationId={conversationId}
                onOpen={openResource}
                onDownload={handleDownload}
                onImportSkill={handleImportSkill}
              />
            ))}
          </div>
          {needsScroll && <FileListScrollFog />}
        </div>

        {showExpand && (
          <button
            type="button"
            className="mt-2 w-full text-left text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            onClick={() => setExpanded(true)}
          >
            查看全部 {files.length} 个文件
          </button>
        )}
      </div>

      {importSkillFile && conversationId && (
        <ImportDraftSkillDialog
          open={!!importSkillFile}
          onOpenChange={(open) => {
            if (!open) setImportSkillFile(null)
          }}
          onSuccess={() => {}}
          conversationId={conversationId}
          skillPath={importSkillFile.path}
          skillName={importSkillFile.title}
        />
      )}
    </>
  )
}
