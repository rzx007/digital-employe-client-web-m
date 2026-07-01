import DocViewer, { DocViewerRenderers } from "@iamjariwala/react-doc-viewer"
import "@iamjariwala/react-doc-viewer/dist/index.css"
import { cn } from "@workspace/ui/lib/utils"
import { getRequestBaseUrl } from "@/lib/request"
import type { Artifact } from "../artifact-types"

export interface DocViewerRendererProps {
  artifact: Artifact
  className?: string
}

const EXTENSION_MIME_MAP: Record<string, string> = {
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx":
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}

function guessMimeFromPath(path: string): string {
  const lower = path.toLowerCase()
  for (const [ext, mime] of Object.entries(EXTENSION_MIME_MAP)) {
    if (lower.endsWith(ext)) return mime
  }
  return "application/pdf"
}

export const DocViewerRenderer = ({
  artifact,
  className,
}: DocViewerRendererProps) => {
  const conversationId = artifact.metadata?.conversationId as
    | string
    | number
    | undefined
  const resourcePath = artifact.metadata?.resourcePath as string | undefined

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

  const lowerPath = resourcePath.toLowerCase()
  const usesOfficeOnline =
    lowerPath.endsWith(".doc") || lowerPath.endsWith(".xls")

  const base = getRequestBaseUrl()
  const isLocalHost =
    /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/i.test(base) ||
    base.startsWith("/")

  if (usesOfficeOnline && isLocalHost) {
    const filename = resourcePath.split("/").pop() ?? "document"
    const formatHint =
      lowerPath.endsWith(".doc") ? "Word (.doc)" : "Excel (.xls)"
    return (
      <div
        className={cn(
          "flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-sm text-muted-foreground",
          className
        )}
      >
        <p className="font-medium text-foreground/80">
          无法在应用内预览此 Office 文档
        </p>
        <p className="max-w-md text-xs">
          旧版 {formatHint} 依赖 Microsoft 在线预览服务，无法访问本机地址（
          {base || "localhost"}）。.docx / .xlsx / .pptx
          已支持本地预览；请下载后用 Office / WPS 打开，或让 AI 另存为新格式。
        </p>
        <p className="font-mono text-xs text-foreground/60">{filename}</p>
      </div>
    )
  }

  const uri = `${base}chat/conversations/${conversationId}/resources/download?path=${encodeURIComponent(resourcePath)}`

  return (
    <div className={cn("min-h-0 min-w-0 flex-1 overflow-hidden", className)}>
      <DocViewer
        documents={[{ uri, fileType: guessMimeFromPath(resourcePath) }]}
        pluginRenderers={DocViewerRenderers}
        config={{
          header: { disableHeader: true },
          pdfVerticalScrollByDefault: true,
        }}
        style={{ width: "100%", height: "100%" }}
      />
    </div>
  )
}
