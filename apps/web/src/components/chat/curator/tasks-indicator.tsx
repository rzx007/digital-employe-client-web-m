import { IconLoader2 } from "@tabler/icons-react"

import { cn } from "@workspace/ui/lib/utils"

import { useUnifiedRunningCount } from "@/hooks/use-unified-tasks"
import { useTasksPanelStore } from "@/stores/tasks-panel-store"

/**
 * 内联「N 个任务运行中 · 查看」指示条（合并子任务 / 后台命令 / 员工任务）。
 * 有进行中任务时显示，count === 0 返回 null。点击打开合并任务面板。
 */
export function TasksIndicator({
  conversationId,
  onOpen,
  className,
}: {
  conversationId: string | number | null
  onOpen?: () => void
  className?: string
}) {
  const count = useUnifiedRunningCount(conversationId)

  if (count === 0) return null

  return (
    <button
      type="button"
      onClick={() => {
        if (onOpen) {
          onOpen()
          return
        }
        useTasksPanelStore.getState().open()
      }}
      className={cn(
        "mx-auto flex w-fit items-center gap-1.5 rounded-full border bg-muted/60 px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
        "animate-in duration-200 fade-in slide-in-from-bottom-1",
        className
      )}
    >
      <IconLoader2 className="size-3 shrink-0 animate-spin" />
      <span>{count} 个任务运行中 · 查看</span>
    </button>
  )
}
