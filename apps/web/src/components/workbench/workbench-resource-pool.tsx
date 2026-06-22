import * as React from "react"
import { toast } from "sonner"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import {
  useWorkbenchResources,
  useUploadWorkbenchResource,
  useDeleteWorkbenchResource,
} from "@/hooks/use-workbench-resources"
import type { WorkbenchResource } from "@/api/workbench-resources"
import { pinHtmlToWorkbench } from "@/lib/workbench/pin-html-to-workbench"
import { WorkbenchHtmlPanel } from "./workbench-html-panel"

/** 资源池拖拽载荷的 dataTransfer 类型键（网格 drop 区据此识别，见 parse-resource-drop）。 */
export const WORKBENCH_RESOURCE_DRAG_TYPE = "application/x-workbench-resource"

/**
 * 资源池面板：用户精选的 HTML 看板库。
 * - 卡片可拖到网格钉看板（拖拽载荷见 WORKBENCH_RESOURCE_DRAG_TYPE）。
 * - 上传 HTML / 删除。仅用户主动操作，agent 不入池。
 */
export function WorkbenchResourcePool({
  className,
  onClose,
}: {
  className?: string
  onClose?: () => void
}) {
  const { data: resources = [], isLoading } = useWorkbenchResources()
  const upload = useUploadWorkbenchResource()
  const del = useDeleteWorkbenchResource()
  const fileRef = React.useRef<HTMLInputElement>(null)
  // 预览中的资源（点卡片预览）
  const [previewId, setPreviewId] = React.useState<number | null>(null)
  const previewResource = resources.find((r) => r.id === previewId) ?? null

  // 把资源池条目钉到工作台网格（带 resourceId，渲染走资源内容端点）。
  const handleAddToWorkbench = (r: WorkbenchResource) => {
    const name = r.title.endsWith(".html") ? r.title : `${r.title}.html`
    pinHtmlToWorkbench({
      conversationId: "resource",
      path: r.src_path,
      name,
      resourceId: r.id,
    })
    toast.success(`已添加到工作台：${r.title}`)
  }

  const handleUpload = (file: File) => {
    if (!/\.html?$/i.test(file.name)) {
      toast.error("只接受 .html 文件")
      return
    }
    upload.mutate(
      { file },
      {
        onSuccess: () => toast.success(`已上传：${file.name}`),
        onError: (e) => toast.error(`上传失败：${String(e)}`),
      }
    )
  }

  const onDragStart = (e: React.DragEvent, r: WorkbenchResource) => {
    e.dataTransfer.setData(
      WORKBENCH_RESOURCE_DRAG_TYPE,
      JSON.stringify({
        id: r.id,
        src_path: r.src_path,
        title: r.title,
        source: r.source,
      })
    )
    e.dataTransfer.effectAllowed = "copy"
  }

  return (
    <div className={cn("flex h-full flex-col gap-2 p-2", className)}>
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">资源池</span>
        <Button
          size="sm"
          variant="outline"
          className="ml-auto"
          onClick={() => fileRef.current?.click()}
          disabled={upload.isPending}
        >
          上传 HTML
        </Button>
        {onClose && (
          <Button size="sm" variant="ghost" onClick={onClose}>
            关闭
          </Button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept=".html,.htm"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) handleUpload(f)
            e.target.value = ""
          }}
        />
      </div>

      {isLoading ? (
        <div className="text-xs text-muted-foreground">加载中…</div>
      ) : resources.length === 0 ? (
        <div className="text-xs text-muted-foreground">
          资源池为空。做完看板后从资源面板「加入资源池」，或上传 HTML。
        </div>
      ) : (
        <div className="flex flex-col gap-2 overflow-auto">
          {resources.map((r) => (
            <div
              key={r.id}
              draggable
              onDragStart={(e) => onDragStart(e, r)}
              onClick={() =>
                setPreviewId((cur) => (cur === r.id ? null : r.id))
              }
              className={cn(
                "group flex cursor-pointer items-center gap-1.5 rounded border bg-card p-2 text-xs",
                previewId === r.id && "border-primary ring-1 ring-primary"
              )}
              title="点击预览/收起，或拖到工作台网格"
            >
              <span className="min-w-0 flex-1 truncate">{r.title}</span>
              <span className="rounded bg-muted px-1 text-[10px] text-muted-foreground">
                {r.source === "upload" ? "上传" : "助手"}
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-1.5 text-[11px]"
                onClick={(e) => {
                  e.stopPropagation()
                  handleAddToWorkbench(r)
                }}
              >
                + 添加
              </Button>
              <button
                type="button"
                aria-label="从资源池移除"
                className="opacity-0 transition-opacity group-hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation()
                  del.mutate(r.id, {
                    onSuccess: () => {
                      toast.success("已移除")
                      if (previewId === r.id) setPreviewId(null)
                    },
                    onError: (err) => toast.error(`移除失败：${String(err)}`),
                  })
                }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 预览区：点卡片在此渲染该 html 看板 */}
      {previewResource && (
        <div className="mt-1 flex min-h-0 flex-1 flex-col overflow-hidden rounded border">
          <div className="flex items-center gap-2 border-b bg-muted/30 px-2 py-1">
            <span className="min-w-0 flex-1 truncate text-xs font-medium">
              预览：{previewResource.title}
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-1.5 text-[11px]"
              onClick={() => setPreviewId(null)}
            >
              收起预览
            </Button>
          </div>
          <div className="min-h-0 flex-1">
            <WorkbenchHtmlPanel
              key={previewResource.id}
              htmlRef={{
                conversationId: "resource",
                resourcePath: previewResource.src_path,
                pinnedAt: 0,
                resourceId: previewResource.id,
              }}
              title={previewResource.title}
              className="h-full"
            />
          </div>
        </div>
      )}
    </div>
  )
}
