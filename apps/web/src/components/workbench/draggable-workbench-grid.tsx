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
import { IconGripVertical, IconPlus, IconTrash } from "@tabler/icons-react"
import { cn } from "@workspace/ui/lib/utils"
import { Button } from "@workspace/ui/components/button"
import { Card, CardContent } from "@workspace/ui/components/card"
import type { WorkbenchBlock } from "@/types/workbench"
import { SkillBlockRenderer } from "./skill-block-renderer"
import { DataVisualizer } from "./data-visualizer"

interface DraggableWorkbenchGridProps {
  blocks: WorkbenchBlock[]
  onReorder: (blockIds: string[]) => void
  onToggleBlock?: (blockId: string) => void
  onRemoveBlock?: (blockId: string) => void
  onResizeBlock?: (blockId: string, width: number, height: number) => void
  /** 模板无模块时，用于居中「添加模板」操作（通常打开添加数据模块弹窗） */
  onAddTemplate?: () => void
}

function SortableBlock({
  block,
  onToggle,
  onRemove,
  onResize,
}: {
  block: WorkbenchBlock
  onToggle?: (blockId: string) => void
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
        "relative",
        isDragging && "z-50 opacity-50"
      )}
    >
      <div className="group relative">
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="absolute left-1 top-1 z-10 cursor-grab opacity-0 transition-opacity group-hover:opacity-100"
        >
          <IconGripVertical className="size-4 text-muted-foreground" />
        </button>

        {onRemove && (
          <button
            type="button"
            onClick={() => onRemove(block.id)}
            className="absolute right-1 top-1 z-10 opacity-0 transition-opacity group-hover:opacity-100"
          >
            <IconTrash className="size-4 text-red-500 hover:text-red-600" />
          </button>
        )}

        {block.enabled ? (
          block.type === "custom" && block.queryInterface ? (
            <ResizableBlock block={block} onResize={onResize} />
          ) : (
            <SkillBlockRenderer
              blockType={block.type}
              title={block.title}
              skillId={block.skillId}
              className="h-[180px]"
            />
          )
        ) : (
          <div className="flex h-[180px] items-center justify-center rounded-lg border border-dashed bg-muted/30">
            <span className="text-xs text-muted-foreground">
              {block.title} (已禁用)
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

function ResizableBlock({
  block,
  onResize,
}: {
  block: WorkbenchBlock
  onResize?: (blockId: string, width: number, height: number) => void
}) {
  const iface = block.queryInterface
  const [isResizing, setIsResizing] = useState(false)
  const [size, setSize] = useState({ width: block.width || 300, height: block.height || 180 })


  const handleMouseDown = useCallback((e: React.MouseEvent) => {
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
      const deltaX = moveEvent.clientX - startX
      const deltaY = moveEvent.clientY - startY
      finalW = Math.max(200, startWidth + deltaX)
      finalH = Math.max(120, startHeight + deltaY)
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
  }, [size.width, size.height, block.id, block.width, block.height, onResize])

  if (!iface) {
    return (
      <Card className="h-[180px] rounded-xl border-dashed border-border/80 bg-muted/20 shadow-none">
        <CardContent className="flex h-full items-center justify-center">
          <div className="text-xs text-muted-foreground">暂无接口配置</div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card
      className={cn(
        "group/card relative overflow-hidden rounded-xl border-border/80 bg-card shadow-sm",
        "ring-1 ring-border/30 transition-[box-shadow,ring-color] hover:shadow-md hover:ring-border/50"
      )}
      style={{ width: size.width, height: size.height }}
    >
      <CardContent className="h-full p-0">
        <DataVisualizer queryInterface={iface} className="text-xs" title={block.title} embedded />
      </CardContent>
      <div
        className={cn(
          "absolute bottom-0.5 right-0.5 flex size-5 cursor-se-resize items-end justify-end rounded-sm p-0.5 opacity-0 transition-opacity group-hover/card:opacity-100",
          isResizing && "opacity-100"
        )}
        onMouseDown={handleMouseDown}
        title="拖拽调整大小"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" className="text-muted-foreground/80" aria-hidden>
          <path d="M14 14L14 8M14 14L8 14M14 14L10 10" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" fill="none" />
        </svg>
      </div>
    </Card>
  )
}

export function DraggableWorkbenchGrid({
  blocks,
  onReorder,
  onToggleBlock,
  onRemoveBlock,
  onResizeBlock,
  onAddTemplate,
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
          "flex w-full flex-col items-center justify-center gap-4 rounded-xl border border-dashed",
          "border-border/70 bg-muted/10 px-6 py-16",
          "min-h-[min(520px,calc(100dvh-14rem))]",
        )}
      >
        {onAddTemplate ? (
          <Button
            type="button"
            size="lg"
            className="gap-2 px-8"
            onClick={onAddTemplate}
          >
            <IconPlus className="size-5" />
            添加模板
          </Button>
        ) : null}
        <div className="max-w-sm text-center">
          <div className="text-sm text-muted-foreground">暂无数据模块</div>
          <div className="mt-2 text-xs text-muted-foreground">
            {onAddTemplate
              ? "从技能解析接口并加入自定义模板，或使用上方「添加模块」"
              : "点击「自定义模板」右侧的「添加模块」开始"}
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
      <SortableContext items={blocks.map((b) => b.id)} strategy={rectSortingStrategy}>
        <div className="flex flex-wrap gap-3">
          {blocks.map((block) => (
            <SortableBlock
              key={block.id}
              block={block}
              onToggle={onToggleBlock}
              onRemove={onRemoveBlock}
              onResize={onResizeBlock}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  )
}
