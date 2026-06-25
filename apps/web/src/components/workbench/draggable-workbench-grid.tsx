import { useState, useCallback } from "react"
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { IconGripVertical, IconTrash } from "@tabler/icons-react"
import { cn } from "@workspace/ui/lib/utils"
import type { WidgetType, WorkbenchWidget } from "@/types/workbench"
import { WidgetRenderer } from "./widgets/widget-renderer"

interface DraggableWorkbenchGridProps {
  widgets: WorkbenchWidget[]
  onReorder: (orderedIds: string[]) => void
  onRemoveWidget: (id: string) => void
  onResizeWidget: (id: string, width: number, height: number) => void
}

// 网格基本单元(与下方 grid 的 minmax/auto-rows/gap 保持一致)
const COL_MIN = 260 // 每列最小宽
const ROW_UNIT = 76 // 单行高
const GAP = 16 // gap-4
const COL_STEP = COL_MIN + GAP
const ROW_STEP = ROW_UNIT + GAP
const MAX_COL_SPAN = 4
const MIN_COL_SPAN = 1
const MAX_ROW_SPAN = 8
const MIN_ROW_SPAN = 2

// 没有显式尺寸时,按类型给一个像样的默认占位:图表/表格更宽更高,KPI/列表更紧凑
const DEFAULT_SIZE: Record<WidgetType, { w: number; h: number }> = {
  kpi: { w: 300, h: 200 },
  list: { w: 300, h: 260 },
  progress: { w: 300, h: 220 },
  table: { w: 560, h: 300 },
  line: { w: 560, h: 260 },
  bar: { w: 560, h: 260 },
  area: { w: 560, h: 260 },
  pie: { w: 360, h: 280 },
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

function effectiveSize(widget: WorkbenchWidget) {
  const d = DEFAULT_SIZE[widget.type] ?? { w: 360, h: 240 }
  return { width: widget.width ?? d.w, height: widget.height ?? d.h }
}

function spansOf(width: number, height: number) {
  return {
    col: clamp(Math.round(width / COL_STEP) || 1, MIN_COL_SPAN, MAX_COL_SPAN),
    row: clamp(Math.round(height / ROW_STEP) || 2, MIN_ROW_SPAN, MAX_ROW_SPAN),
  }
}

function SortableBlock({
  widget,
  onRemove,
  onResize,
}: {
  widget: WorkbenchWidget
  onRemove: (id: string) => void
  onResize: (id: string, width: number, height: number) => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: widget.id })

  // 拖拽缩放时的实时尺寸(像素),用于即时换算 span 做吸附预览
  const [size, setSize] = useState(() => effectiveSize(widget))
  const [isResizing, setIsResizing] = useState(false)
  const span = spansOf(size.width, size.height)

  const handleResizeDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setIsResizing(true)
      const startX = e.clientX
      const startY = e.clientY
      const start = effectiveSize(widget)
      let finalW = start.width
      let finalH = start.height
      const onMove = (ev: MouseEvent) => {
        finalW = Math.max(COL_MIN, start.width + (ev.clientX - startX))
        finalH = Math.max(160, start.height + (ev.clientY - startY))
        setSize({ width: finalW, height: finalH })
      }
      const onUp = () => {
        setIsResizing(false)
        document.removeEventListener("mousemove", onMove)
        document.removeEventListener("mouseup", onUp)
        if (finalW !== widget.width || finalH !== widget.height) {
          onResize(widget.id, finalW, finalH)
        }
      }
      document.addEventListener("mousemove", onMove)
      document.addEventListener("mouseup", onUp)
    },
    [widget, onResize]
  )

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        gridColumn: `span ${span.col}`,
        gridRow: `span ${span.row}`,
      }}
      className={cn(
        "group/sortable relative isolate min-w-0",
        "transition-[box-shadow,opacity] duration-200 ease-out",
        isDragging &&
        "z-50 cursor-grabbing opacity-[0.92] shadow-lg ring-2 ring-primary/25 ring-offset-2 ring-offset-background",
        isResizing && "z-40"
      )}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        title="拖动排序"
        className={cn(
          "absolute top-1.5 left-1.5 z-20 flex size-7 cursor-grab items-center justify-center rounded-md",
          "border border-border/60 bg-background/95 text-muted-foreground shadow-sm backdrop-blur",
          "opacity-0 transition-[opacity,colors] duration-200 ease-out",
          "hover:border-border hover:bg-muted/80 hover:text-foreground",
          "active:scale-[0.97] active:cursor-grabbing",
          "focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          "group-hover/sortable:opacity-100"
        )}
      >
        <IconGripVertical className="size-4" stroke={1.5} />
      </button>

      <button
        type="button"
        data-testid="remove-widget"
        onClick={() => onRemove(widget.id)}
        title="移除此模块"
        className={cn(
          "absolute top-1.5 right-1.5 z-20 flex size-7 items-center justify-center rounded-md",
          "border border-transparent text-muted-foreground",
          "opacity-0 transition-[opacity,colors] duration-200 ease-out",
          "hover:border-border/80 hover:bg-destructive/10 hover:text-destructive",
          "active:scale-[0.97]",
          "focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          "group-hover/sortable:opacity-100"
        )}
      >
        <IconTrash className="size-4" stroke={1.5} />
      </button>

      <div className="h-full w-full">
        <WidgetRenderer widget={widget} />
      </div>

      <div
        className={cn(
          "absolute right-1 bottom-1 z-20 flex size-5 cursor-se-resize items-end justify-end rounded-sm p-0.5",
          "opacity-0 transition-opacity group-hover/sortable:opacity-100",
          isResizing && "opacity-100"
        )}
        onMouseDown={handleResizeDown}
        title="拖拽调整大小"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          className="text-muted-foreground/70"
          aria-hidden
        >
          <path
            d="M14 14L14 8M14 14L8 14M14 14L10 10"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            fill="none"
          />
        </svg>
      </div>
    </div>
  )
}

export function DraggableWorkbenchGrid({
  widgets,
  onReorder,
  onRemoveWidget,
  onResizeWidget,
}: DraggableWorkbenchGridProps) {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (over && active.id !== over.id) {
      const oldIndex = widgets.findIndex((w) => w.id === active.id)
      const newIndex = widgets.findIndex((w) => w.id === over.id)
      const newIds = [...widgets.map((w) => w.id)]
      newIds.splice(oldIndex, 1)
      newIds.splice(newIndex, 0, active.id as string)
      onReorder(newIds)
    }
  }

  if (widgets.length === 0) {
    return (
      <div
        className={cn(
          "flex w-full flex-col items-center justify-center gap-3 rounded-xl border border-dashed",
          "border-border/70 bg-card/40 px-6 py-16",
          "min-h-[min(520px,calc(100dvh-14rem))]"
        )}
      >
        <div className="max-w-sm text-center">
          <div className="text-sm text-muted-foreground">暂无统计块</div>
          <div className="mt-2 text-xs text-muted-foreground">
            让总管帮你生成统计看板，然后在资源面板里「钉到工作台」
          </div>
        </div>
      </div>
    )
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={widgets.map((w) => w.id)}
        strategy={rectSortingStrategy}
      >
        <div
          className="grid gap-3 [grid-auto-flow:row_dense]"
          style={{
            gridTemplateColumns: `repeat(auto-fill, minmax(${COL_MIN}px, 1fr))`,
            gridAutoRows: `${ROW_UNIT}px`,
          }}
        >
          {widgets.map((widget) => (
            <SortableBlock
              key={widget.id}
              widget={widget}
              onRemove={onRemoveWidget}
              onResize={onResizeWidget}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  )
}
