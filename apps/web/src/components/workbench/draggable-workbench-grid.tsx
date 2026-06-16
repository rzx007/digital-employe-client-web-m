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
import type { WorkbenchBlock } from "@/types/workbench"
import { WorkbenchHtmlPanel } from "./workbench-html-panel"

interface DraggableWorkbenchGridProps {
  blocks: WorkbenchBlock[]
  onReorder: (blockIds: string[]) => void
  onRemoveBlock?: (blockId: string) => void
  onResizeBlock?: (blockId: string, width: number, height: number) => void
}

function SortableBlock({
  block,
  onRemove,
  onResize,
}: {
  block: WorkbenchBlock
  onRemove?: (blockId: string) => void
  onResize?: (blockId: string, width: number, height: number) => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: block.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "relative isolate rounded-md",
        "transition-[box-shadow,opacity] duration-200 ease-out",
        isDragging &&
          "z-50 cursor-grabbing opacity-[0.92] shadow-lg ring-2 ring-primary/25 ring-offset-2 ring-offset-background"
      )}
    >
      <div
        className={cn(
          "group/sortable relative rounded-md",
          !isDragging &&
            "hover:shadow-md hover:shadow-black/5 dark:hover:shadow-black/25"
        )}
      >
        <button
          type="button"
          {...attributes}
          {...listeners}
          title="拖动排序"
          className={cn(
            "absolute top-0 left-2 z-20 flex size-8 cursor-grab items-center justify-center rounded-md",
            "border border-border/60 bg-background/95 text-muted-foreground shadow-sm",
            "opacity-0 transition-[opacity,transform,colors] duration-200 ease-out",
            "hover:border-border hover:bg-muted/80 hover:text-foreground",
            "active:scale-[0.97] active:cursor-grabbing",
            "focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none",
            "group-hover/sortable:opacity-100"
          )}
        >
          <IconGripVertical className="size-4" stroke={1.5} />
        </button>

        {onRemove && (
          <button
            type="button"
            onClick={() => onRemove(block.id)}
            title="移除此模块"
            className={cn(
              "absolute top-0 right-2 z-20 flex size-8 items-center justify-center rounded-lg",
              "border border-transparent text-muted-foreground",
              "opacity-0 transition-[opacity,transform,colors,background-color,border-color] duration-200 ease-out",
              "hover:border-border/80 hover:bg-destructive/10 hover:text-destructive",
              "active:scale-[0.97]",
              "focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none",
              "group-hover/sortable:opacity-100"
            )}
          >
            <IconTrash className="size-4" stroke={1.5} />
          </button>
        )}

        <ResizableHtmlBlock block={block} onResize={onResize} />
      </div>
    </div>
  )
}

function ResizableHtmlBlock({
  block,
  onResize,
}: {
  block: WorkbenchBlock
  onResize?: (blockId: string, width: number, height: number) => void
}) {
  const [isResizing, setIsResizing] = useState(false)
  const [size, setSize] = useState({
    width: block.width || 360,
    height: block.height || 240,
  })

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setIsResizing(true)
      const startX = e.clientX
      const startY = e.clientY
      const startWidth = size.width
      const startHeight = size.height
      let finalW = startWidth
      let finalH = startHeight
      const handleMouseMove = (moveEvent: MouseEvent) => {
        finalW = Math.max(240, startWidth + (moveEvent.clientX - startX))
        finalH = Math.max(160, startHeight + (moveEvent.clientY - startY))
        setSize({ width: finalW, height: finalH })
      }
      const handleMouseUp = () => {
        setIsResizing(false)
        document.removeEventListener("mousemove", handleMouseMove)
        document.removeEventListener("mouseup", handleMouseUp)
        if (onResize && (finalW !== block.width || finalH !== block.height)) {
          onResize(block.id, finalW, finalH)
        }
      }
      document.addEventListener("mousemove", handleMouseMove)
      document.addEventListener("mouseup", handleMouseUp)
    },
    [size.width, size.height, block.id, block.width, block.height, onResize]
  )

  return (
    <div
      className={cn(
        "group/card relative overflow-hidden rounded-md",
        "transition-[box-shadow] hover:shadow-md"
      )}
      style={{ width: size.width, height: size.height }}
    >
      <WorkbenchHtmlPanel
        htmlRef={block.htmlRef}
        title={block.title}
        className="h-full"
      />
      <div
        className={cn(
          "absolute right-0.5 bottom-0.5 flex size-5 cursor-se-resize items-end justify-end rounded-sm p-0.5 opacity-0 transition-opacity group-hover/card:opacity-100",
          isResizing && "opacity-100"
        )}
        onMouseDown={handleMouseDown}
        title="拖拽调整大小"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          className="text-muted-foreground/80"
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
  blocks,
  onReorder,
  onRemoveBlock,
  onResizeBlock,
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
      const oldIndex = blocks.findIndex((b) => b.id === active.id)
      const newIndex = blocks.findIndex((b) => b.id === over.id)

      const newBlockIds = [...blocks.map((b) => b.id)]
      newBlockIds.splice(oldIndex, 1)
      newBlockIds.splice(newIndex, 0, active.id as string)

      onReorder(newBlockIds)
    }
  }

  if (blocks.length === 0) {
    return (
      <div
        className={cn(
          "flex w-full flex-col items-center justify-center gap-3 rounded-xl border border-dashed",
          "border-border/70 bg-muted/10 px-6 py-16",
          "min-h-[min(520px,calc(100dvh-14rem))]"
        )}
      >
        <div className="max-w-sm text-center">
          <div className="text-sm text-muted-foreground">还没有看板</div>
          <div className="mt-2 text-xs text-muted-foreground">
            在右侧让总管生成一个 HTML 看板，然后在资源面板里「钉到工作台」
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
        items={blocks.map((b) => b.id)}
        strategy={rectSortingStrategy}
      >
        <div className="flex flex-wrap gap-3">
          {blocks.map((block) => (
            <SortableBlock
              key={block.id}
              block={block}
              onRemove={onRemoveBlock}
              onResize={onResizeBlock}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  )
}
