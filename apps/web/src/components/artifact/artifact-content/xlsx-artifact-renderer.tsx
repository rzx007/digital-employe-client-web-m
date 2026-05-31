import "./office-artifact-preview.css"
import { useQuery } from "@tanstack/react-query"
import { IconDownload } from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { useState } from "react"
import * as XLSX from "xlsx"
import { downloadResource, downloadResourceBlob } from "@/api/chat"
import { Spinner } from "@/components/spinner"
import { chatKeys } from "@/lib/query-keys/chat"
import type { Artifact } from "../artifact-types"

export interface XlsxArtifactRendererProps {
  artifact: Artifact
  className?: string
}

type XlsxSheetPreview = {
  name: string
  html: string
}

type XlsxPreviewData = {
  sheets: XlsxSheetPreview[]
}

async function parseXlsxPreview(
  conversationId: string | number,
  resourcePath: string,
  signal: AbortSignal
): Promise<XlsxPreviewData> {
  const blob = await downloadResourceBlob(conversationId, resourcePath)
  if (signal.aborted) throw new Error("aborted")

  if (blob.type.includes("json") || blob.type.includes("text")) {
    const text = await blob.text()
    throw new Error(text.slice(0, 120) || "文件下载失败")
  }

  const buffer = await blob.arrayBuffer()
  const header = new Uint8Array(buffer.slice(0, 2))
  const isZipArchive = header[0] === 0x50 && header[1] === 0x4b
  if (!isZipArchive) {
    throw new Error("不是有效的 XLSX 文件，请尝试重新生成或下载查看")
  }

  const workbook = XLSX.read(buffer, { type: "array" })
  if (!workbook.SheetNames.length) {
    throw new Error("工作簿中没有可预览的工作表")
  }

  return {
    sheets: workbook.SheetNames.map((name) => ({
      name,
      html: XLSX.utils.sheet_to_html(workbook.Sheets[name] ?? {}, {
        editable: false,
      }),
    })),
  }
}

export function XlsxArtifactRenderer({
  artifact,
  className,
}: XlsxArtifactRendererProps) {
  const [activeSheet, setActiveSheet] = useState(0)

  const conversationId = artifact.metadata?.conversationId as
    | string
    | number
    | undefined
  const resourcePath = artifact.metadata?.resourcePath as string | undefined

  const {
    data: preview,
    isLoading,
    error,
  } = useQuery({
    queryKey: chatKeys.resourceXlsxPreview(
      String(conversationId),
      resourcePath ?? ""
    ),
    queryFn: ({ signal }) =>
      parseXlsxPreview(conversationId!, resourcePath!, signal),
    enabled: conversationId != null && !!resourcePath,
    staleTime: 60_000,
  })

  const handleDownload = () => {
    if (conversationId && resourcePath) {
      void downloadResource(conversationId, resourcePath)
    }
  }

  if (!conversationId || !resourcePath) {
    return (
      <div
        className={cn(
          "flex min-h-0 min-w-0 flex-1 items-center justify-center text-sm text-muted-foreground",
          className
        )}
      >
        <p>无法加载表格：缺少会话或资源路径</p>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div
        className={cn(
          "flex min-h-0 min-w-0 flex-1 items-center justify-center gap-2 text-sm text-muted-foreground",
          className
        )}
      >
        <Spinner className="size-4" />
        正在加载 Excel 表格…
      </div>
    )
  }

  if (error || !preview?.sheets.length) {
    return (
      <div
        className={cn(
          "flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground",
          className
        )}
      >
        <p>
          {error instanceof Error
            ? error.message
            : "Excel 表格解析失败，请尝试下载后在 Office / WPS 中打开。"}
        </p>
        <Button size="sm" variant="outline" onClick={handleDownload}>
          <IconDownload className="size-4" />
          下载文件
        </Button>
      </div>
    )
  }

  const safeActiveSheet = Math.min(activeSheet, preview.sheets.length - 1)
  const currentSheet = preview.sheets[safeActiveSheet]

  return (
    <div
      className={cn(
        "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background",
        className
      )}
    >
      {preview.sheets.length > 1 ? (
        <div className="flex shrink-0 gap-1 overflow-x-auto border-b px-2 py-1.5">
          {preview.sheets.map((sheet, index) => (
            <Button
              key={sheet.name}
              size="sm"
              variant={index === safeActiveSheet ? "secondary" : "ghost"}
              className="h-7 shrink-0 px-2 text-xs"
              onClick={() => setActiveSheet(index)}
            >
              {sheet.name}
            </Button>
          ))}
        </div>
      ) : null}
      <div className="xlsx-artifact-preview min-h-0 min-w-0 flex-1 overflow-auto p-3">
        <div
          className="xlsx-artifact-preview-table min-w-max rounded-md border bg-card text-sm"
          dangerouslySetInnerHTML={{ __html: currentSheet.html }}
        />
      </div>
    </div>
  )
}
