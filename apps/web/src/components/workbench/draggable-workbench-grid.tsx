import { useMemo } from "react"
import GridLayout, {
  useContainerWidth,
  type EventCallback,
  type LayoutItem,
} from "react-grid-layout"
import { IconTrash } from "@tabler/icons-react"
import { cn } from "@workspace/ui/lib/utils"
import type { GridSpan, GridPos, WorkbenchBlock } from "@/types/workbench"
import { GRID_COLS, GRID_ROW_HEIGHT } from "@/lib/workbench/grid"
import { parseResourceDrop } from "@/lib/workbench/parse-resource-drop"
import { pinHtmlToWorkbench } from "@/lib/workbench/pin-html-to-workbench"
import { WORKBENCH_RESOURCE_DRAG_TYPE } from "./workbench-resource-pool"
import { WorkbenchHtmlPanel } from "./workbench-html-panel"
// react-grid-layout v2 自带 resize 手柄样式，不再依赖 react-resizable（v1 才需要）。
import "react-grid-layout/css/styles.css"

interface DraggableWorkbenchGridProps {
  blocks: WorkbenchBlock[]
  onMoveResize: (blockId: string, pos: GridPos, span: GridSpan) => void
  onRemoveBlock?: (blockId: string) => void
}

export function DraggableWorkbenchGrid({
  blocks,
  onMoveResize,
  onRemoveBlock,
}: DraggableWorkbenchGridProps) {
  const { width, containerRef, mounted } = useContainerWidth()
  const visible = useMemo(() => blocks.filter((b) => b.enabled), [blocks])

  // 资源池卡片拖到网格 → 钉成看板（资源池来源带 resourceId，渲染走资源内容端点）。
  const handleDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes(WORKBENCH_RESOURCE_DRAG_TYPE)) {
      e.preventDefault()
      e.dataTransfer.dropEffect = "copy"
    }
  }
  const handleDrop = (e: React.DragEvent) => {
    const dropped = parseResourceDrop(
      e.dataTransfer.getData(WORKBENCH_RESOURCE_DRAG_TYPE)
    )
    if (!dropped) return
    e.preventDefault()
    const name = dropped.title.endsWith(".html")
      ? dropped.title
      : `${dropped.title}.html`
    pinHtmlToWorkbench({
      conversationId: "resource",
      path: dropped.src_path,
      name,
      resourceId: dropped.id,
    })
  }

  const layout = useMemo<LayoutItem[]>(
    () =>
      visible.map((b) => ({
        i: b.id,
        x: b.gridPos.x,
        y: b.gridPos.y,
        w: b.gridSpan.w,
        h: b.gridSpan.h,
        minW: 2,
        minH: 2,
      })),
    [visible]
  )

  if (visible.length === 0) {
    return (
      <div
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        className={cn(
          "flex w-full flex-col items-center justify-center gap-3 rounded-xl border border-dashed",
          "border-border/70 bg-muted/10 px-6 py-16",
          "min-h-[min(520px,calc(100dvh-14rem))]"
        )}
      >
        <div className="max-w-sm text-center">
          <div className="text-sm text-muted-foreground">还没有看板</div>
          <div className="mt-2 text-xs text-muted-foreground">
            在右侧让工作台助手「做一个看板」，或从资源池把看板拖到这里
          </div>
        </div>
      </div>
    )
  }

  const handleLayoutChange: EventCallback = (next) => {
    for (const item of next) {
      const block = visible.find((b) => b.id === item.i)
      if (!block) continue
      const moved = block.gridPos.x !== item.x || block.gridPos.y !== item.y
      const resized = block.gridSpan.w !== item.w || block.gridSpan.h !== item.h
      if (moved || resized) {
        onMoveResize(item.i, { x: item.x, y: item.y }, { w: item.w, h: item.h })
      }
    }
  }

  return (
    <div
      ref={containerRef}
      className="w-full"
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {mounted && (
        <GridLayout
          className="layout"
          layout={layout}
          width={width}
          gridConfig={{
            cols: GRID_COLS,
            rowHeight: GRID_ROW_HEIGHT,
            margin: [12, 12],
          }}
          dragConfig={{ handle: ".wb-drag-handle" }}
          onDragStop={handleLayoutChange}
          onResizeStop={handleLayoutChange}
        >
          {visible.map((block) => (
            <div key={block.id} className="group/card relative">
              {/* 拖拽手柄只盖看板头栏左侧（标题区），右侧留白避开面板自带的刷新/全屏/删除按钮，
                  否则这条 z-10 strip 会吞掉那些按钮的点击 */}
              <div
                className="wb-drag-handle absolute top-0 left-0 right-16 z-10 h-7 cursor-grab rounded-tl-md bg-muted/40 opacity-0 transition-opacity group-hover/card:opacity-100"
                title="拖动"
              />
              {onRemoveBlock && (
                <button
                  type="button"
                  onClick={() => onRemoveBlock(block.id)}
                  title="移除此看板"
                  className={cn(
                    "absolute top-0 right-2 z-20 flex size-7 items-center justify-center rounded-lg",
                    "text-muted-foreground opacity-0 transition-opacity",
                    "hover:bg-destructive/10 hover:text-destructive",
                    "group-hover/card:opacity-100"
                  )}
                >
                  <IconTrash className="size-4" stroke={1.5} />
                </button>
              )}
              <WorkbenchHtmlPanel
                htmlRef={block.htmlRef}
                title={block.title}
                className="h-full overflow-hidden rounded-md"
              />
            </div>
          ))}
        </GridLayout>
      )}
    </div>
  )
}
