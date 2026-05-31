import "./office-artifact-preview.css"
import { renderAsync } from "docx-preview"
import { useQuery } from "@tanstack/react-query"
import { IconDownload } from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { useEffect, useRef } from "react"
import { downloadResource, downloadResourceBlob } from "@/api/chat"
import { Spinner } from "@/components/spinner"
import { chatKeys } from "@/lib/query-keys/chat"
import type { Artifact } from "../artifact-types"

export interface DocxArtifactRendererProps {
  artifact: Artifact
  className?: string
}

async function fetchDocxBlob(
  conversationId: string | number,
  resourcePath: string,
  signal: AbortSignal
) {
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
    throw new Error("不是有效的 DOCX 文件，请尝试重新生成或下载查看")
  }

  return blob
}

export function DocxArtifactRenderer({
  artifact,
  className,
}: DocxArtifactRendererProps) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const styleRef = useRef<HTMLDivElement>(null)

  const conversationId = artifact.metadata?.conversationId as
    | string
    | number
    | undefined
  const resourcePath = artifact.metadata?.resourcePath as string | undefined

  const {
    data: docxBlob,
    isLoading,
    error,
  } = useQuery({
    queryKey: chatKeys.resourceDocxPreview(
      String(conversationId),
      resourcePath ?? ""
    ),
    queryFn: ({ signal }) =>
      fetchDocxBlob(conversationId!, resourcePath!, signal),
    enabled: conversationId != null && !!resourcePath,
    staleTime: 60_000,
  })

  useEffect(() => {
    const body = bodyRef.current
    const style = styleRef.current
    if (!body || !docxBlob) return

    body.innerHTML = ""
    if (style) style.innerHTML = ""

    let cancelled = false
    void renderAsync(docxBlob, body, style ?? undefined, {
      className: "docx-preview-content",
      inWrapper: true,
      ignoreWidth: false,
      ignoreHeight: false,
      breakPages: true,
    }).catch((renderError: unknown) => {
      if (cancelled) return
      const message =
        renderError instanceof Error
          ? renderError.message
          : "Word 文档渲染失败"
      body.innerHTML = `<p class="text-sm text-muted-foreground">${message}</p>`
    })

    return () => {
      cancelled = true
    }
  }, [docxBlob])

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
        <p>无法加载文档：缺少会话或资源路径</p>
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
        正在加载 Word 文档…
      </div>
    )
  }

  if (error || !docxBlob) {
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
            : "Word 文档解析失败，请尝试下载后在 Office / WPS 中打开。"}
        </p>
        <Button size="sm" variant="outline" onClick={handleDownload}>
          <IconDownload className="size-4" />
          下载文件
        </Button>
      </div>
    )
  }

  return (
    <div
      className={cn(
        "docx-artifact-preview min-h-0 min-w-0 flex-1 overflow-auto bg-background p-4",
        className
      )}
    >
      <div ref={styleRef} className="docx-artifact-preview-styles" />
      <div ref={bodyRef} className="docx-artifact-preview-body min-w-0" />
    </div>
  )
}
