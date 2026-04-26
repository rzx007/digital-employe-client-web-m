import { cn } from "@workspace/ui/lib/utils"

import cssIcon from "@/assets/files/css.png"
import docIcon from "@/assets/files/doc.png"
import docxIcon from "@/assets/files/docx.png"
import folderIcon from "@/assets/files/fold.png"
import htmlIcon from "@/assets/files/html.png"
import mdIcon from "@/assets/files/md.png"
import pdfIcon from "@/assets/files/pdf.png"
import plainIcon from "@/assets/files/plain_dark.png"
import svgIcon from "@/assets/files/svg.png"
import txtIcon from "@/assets/files/txt.png"
import xlsIcon from "@/assets/files/xls.png"
import xlsxIcon from "@/assets/files/xlsx.png"
import type { FileChangeItem } from "@/lib/chat/file-change-utils"
import { useArtifactStore } from "@/stores/artifact-store"

interface FileChangeCardsProps {
  files: FileChangeItem[]
  className?: string
}

const EXTENSION_ICONS: Record<string, string> = {
  css: cssIcon,
  doc: docIcon,
  docx: docxIcon,
  html: htmlIcon,
  htm: htmlIcon,
  md: mdIcon,
  pdf: pdfIcon,
  svg: svgIcon,
  text: txtIcon,
  txt: txtIcon,
  xls: xlsIcon,
  xlsx: xlsxIcon,
}

function getIcon(file: FileChangeItem) {
  if (file.kind === "skill-folder") {
    return folderIcon
  }

  return file.extension ? EXTENSION_ICONS[file.extension] ?? plainIcon : plainIcon
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

export function FileChangeCards({ files, className }: FileChangeCardsProps) {
  const openResource = useArtifactStore((s) => s.openResource)

  if (files.length === 0) {
    return null
  }

  return (
    <div
      className={cn(
        "not-prose w-full rounded-lg border border-border/50 bg-muted/30 px-3 py-2",
        className
      )}
    >
      <div className="mb-2 text-xs font-medium text-muted-foreground">
        本轮文件变更
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {files.map((file) => {
          const size = formatSize(file.size)

          return (
            <button
              className="flex min-w-0 cursor-pointer items-center gap-3 rounded-md border border-border/50 bg-background/70 px-3 py-2 text-left transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              key={file.id}
              onClick={() => openResource(file.path)}
              type="button"
            >
              <img
                alt=""
                aria-hidden="true"
                className="size-8 shrink-0"
                draggable={false}
                src={getIcon(file)}
              />
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-sm font-medium text-foreground">
                    {file.title}
                  </span>
                  <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {getActionLabel(file)}
                  </span>
                </div>
                <div className="mt-0.5 flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
                  <span className="truncate">{file.path}</span>
                  {size && <span className="shrink-0">{size}</span>}
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
