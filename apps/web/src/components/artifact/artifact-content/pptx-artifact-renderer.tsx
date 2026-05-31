import {
  parsePPTX,
  PPTXViewer,
  type PPTXData,
} from "@kandiforge/pptx-renderer"
import { useQuery } from "@tanstack/react-query"
import { IconDownload } from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import * as React from "react"
import { useEffect, useRef, useState } from "react"
import { downloadResource, downloadResourceBlob } from "@/api/chat"
import { Spinner } from "@/components/spinner"
import { chatKeys } from "@/lib/query-keys/chat"
import type { Artifact } from "../artifact-types"

export interface PptxArtifactRendererProps {
  artifact: Artifact
  className?: string
}

function normalizePptxData(raw: unknown): PPTXData | null {
  if (!raw || typeof raw !== "object") return null
  const data = raw as Partial<PPTXData>
  if (!Array.isArray(data.slides) || data.slides.length === 0) return null
  if (
    !data.size ||
    typeof data.size.width !== "number" ||
    typeof data.size.height !== "number" ||
    data.size.width <= 0 ||
    data.size.height <= 0
  ) {
    return null
  }

  return {
    ...data,
    slides: data.slides.map((slide) => ({
      ...slide,
      shapes: Array.isArray(slide.shapes) ? slide.shapes : [],
      masterShapes: Array.isArray(slide.masterShapes) ? slide.masterShapes : [],
      layoutShapes: Array.isArray(slide.layoutShapes) ? slide.layoutShapes : [],
      slideShapes: Array.isArray(slide.slideShapes) ? slide.slideShapes : [],
    })),
    size: data.size,
  }
}

function useSlideViewportSize(containerRef: React.RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState({ width: 960, height: 540 })

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const update = (width: number) => {
      const nextWidth = Math.max(320, Math.floor(width))
      setSize({
        width: nextWidth,
        height: Math.max(180, Math.floor((nextWidth * 9) / 16)),
      })
    }

    update(el.clientWidth)
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) update(entry.contentRect.width)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [containerRef])

  return size
}

type PptxPreviewErrorBoundaryProps = {
  children: React.ReactNode
  onDownload: () => void
  className?: string
}

type PptxPreviewErrorBoundaryState = {
  error: Error | null
}

class PptxPreviewErrorBoundary extends React.Component<
  PptxPreviewErrorBoundaryProps,
  PptxPreviewErrorBoundaryState
> {
  state: PptxPreviewErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <div
          className={cn(
            "flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground",
            this.props.className
          )}
        >
          <p>幻灯片渲染失败：{this.state.error.message}</p>
          <Button size="sm" variant="outline" onClick={this.props.onDownload}>
            <IconDownload className="size-4" />
            下载文件
          </Button>
        </div>
      )
    }

    return this.props.children
  }
}

export function PptxArtifactRenderer({
  artifact,
  className,
}: PptxArtifactRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const size = useSlideViewportSize(containerRef)

  const conversationId = artifact.metadata?.conversationId as
    | string
    | number
    | undefined
  const resourcePath = artifact.metadata?.resourcePath as string | undefined

  const {
    data: pptxData,
    isLoading,
    error,
  } = useQuery({
    queryKey: chatKeys.resourcePptxPreview(
      String(conversationId),
      resourcePath ?? ""
    ),
    queryFn: async ({ signal }) => {
      const blob = await downloadResourceBlob(conversationId!, resourcePath!)
      if (signal.aborted) throw new Error("aborted")

      if (blob.type.includes("json") || blob.type.includes("text")) {
        const text = await blob.text()
        throw new Error(text.slice(0, 120) || "文件下载失败")
      }

      const buffer = await blob.arrayBuffer()
      const header = new Uint8Array(buffer.slice(0, 2))
      const isZipArchive = header[0] === 0x50 && header[1] === 0x4b
      if (!isZipArchive) {
        throw new Error("不是有效的 PPTX 文件，请尝试重新生成或下载查看")
      }

      const parsed = await parsePPTX(buffer)
      const normalized = normalizePptxData(parsed)
      if (!normalized) {
        throw new Error("未能从文件中解析出幻灯片")
      }
      return normalized
    },
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
        <p>无法加载演示文稿：缺少会话或资源路径</p>
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
        正在加载演示文稿…
      </div>
    )
  }

  if (error || !pptxData) {
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
            : "演示文稿解析失败，请尝试下载后在 PowerPoint / WPS 中打开。"}
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
      ref={containerRef}
      className={cn("min-h-0 min-w-0 flex-1 overflow-hidden p-2", className)}
    >
      <PptxPreviewErrorBoundary
        className={className}
        onDownload={handleDownload}
      >
        <PPTXViewer
          pptxData={pptxData}
          width={size.width}
          height={size.height}
          showFilmstrip
          filmstripPosition="bottom"
          showModeToggle={false}
        />
      </PptxPreviewErrorBoundary>
    </div>
  )
}
