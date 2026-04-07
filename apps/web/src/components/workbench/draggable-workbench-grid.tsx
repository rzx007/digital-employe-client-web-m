import { useState } from "react"
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
import { IconGripVertical, IconTrash, IconExternalLink } from "@tabler/icons-react"
import { cn } from "@workspace/ui/lib/utils"
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/ui/components/card"
import type { WorkbenchBlock } from "@/types/workbench"
import { SkillBlockRenderer } from "./skill-block-renderer"

interface DraggableWorkbenchGridProps {
  blocks: WorkbenchBlock[]
  onReorder: (blockIds: string[]) => void
  onToggleBlock?: (blockId: string) => void
  onRemoveBlock?: (blockId: string) => void
}

function SortableBlock({
  block,
  onToggle,
  onRemove,
}: {
  block: WorkbenchBlock
  onToggle?: (blockId: string) => void
  onRemove?: (blockId: string) => void
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

        {onToggle && (
          <button
            type="button"
            onClick={() => onToggle(block.id)}
            className={cn(
              "absolute right-6 top-1 z-10 rounded px-1.5 py-0.5 text-[10px] opacity-0 transition-opacity group-hover:opacity-100",
              block.enabled
                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300"
                : "bg-muted text-muted-foreground"
            )}
          >
            {block.enabled ? "已启用" : "已禁用"}
          </button>
        )}

        {block.enabled ? (
          block.type === "custom" && block.queryInterface ? (
            <CustomInterfaceBlock block={block} />
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

function CustomInterfaceBlock({ block }: { block: WorkbenchBlock }) {
  const iface = block.queryInterface

  return (
    <Card className="h-[180px]">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <span className="truncate">{block.title}</span>
          {iface && (
            <span className={cn(
              "shrink-0 text-xs px-1.5 py-0.5 rounded",
              iface.method === "GET" ? "bg-green-100 text-green-700" :
              iface.method === "POST" ? "bg-blue-100 text-blue-700" :
              iface.method === "PUT" ? "bg-yellow-100 text-yellow-700" :
              "bg-red-100 text-red-700"
            )}>
              {iface.method}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0 px-4 pb-4">
        {iface ? (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground line-clamp-2">
              {iface.description || "无描述"}
            </p>
            <div className="flex items-center gap-1 text-xs font-mono text-muted-foreground/70">
              <IconExternalLink className="size-3" />
              <span className="truncate">{iface.path}</span>
            </div>
            <div className="mt-2 text-xs text-muted-foreground/60">
              点击查看数据
            </div>
          </div>
        ) : (
          <div className="flex h-[100px] items-center justify-center text-xs text-muted-foreground">
            暂无接口配置
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function DraggableWorkbenchGrid({
  blocks,
  onReorder,
  onToggleBlock,
  onRemoveBlock,
}: DraggableWorkbenchGridProps) {
  const [activeId, setActiveId] = useState<string | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  const handleDragStart = (event: { active: { id: string } }) => {
    setActiveId(event.active.id as string)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null)
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
      <div className="flex h-[200px] items-center justify-center rounded-lg border border-dashed">
        <div className="text-center">
          <div className="text-sm text-muted-foreground">暂无工作台模块</div>
          <div className="mt-1 text-xs text-muted-foreground">
            点击右上角"添加模块"开始
          </div>
        </div>
      </div>
    )
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={blocks.map((b) => b.id)} strategy={rectSortingStrategy}>
        <div className="grid grid-cols-2 gap-3">
          {blocks.map((block) => (
            <SortableBlock
              key={block.id}
              block={block}
              onToggle={onToggleBlock}
              onRemove={onRemoveBlock}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  )
}
