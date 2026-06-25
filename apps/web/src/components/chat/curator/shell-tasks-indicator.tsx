import { IconTerminal2 } from "@tabler/icons-react"

import { cn } from "@workspace/ui/lib/utils"

import { useShellExecutions } from "@/hooks/use-shell-executions"
import { useShellTasksPanelStore } from "@/stores/shell-tasks-panel-store"

/**
 * 内联「N 个后台命令」指示条。
 * 有进行中后台命令时显示，count === 0 返回 null。
 * 点击打开后台命令面板。
 */
export function ShellTasksIndicator({
  conversationId,
  onOpenShellTasks,
  className,
}: {
  conversationId: string | number | null
  onOpenShellTasks?: () => void
  className?: string
}) {
  const { data: executions = [] } = useShellExecutions(conversationId)

  const count = executions.filter((e) => e.running).length

  if (count === 0) return null

  return (
    <button
      type="button"
      onClick={() => {
        if (onOpenShellTasks) {
          onOpenShellTasks()
          return
        }
        useShellTasksPanelStore.getState().toggle()
      }}
      className={cn(
        "mx-auto flex w-fit items-center gap-1.5 rounded-full border bg-muted/60 px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
        "animate-in duration-200 fade-in slide-in-from-bottom-1",
        className
      )}
    >
      <IconTerminal2 className="size-3 shrink-0 animate-pulse" />
      <span>{count} 个后台命令</span>
    </button>
  )
}
