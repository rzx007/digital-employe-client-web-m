import { IconTerminal2 } from "@tabler/icons-react"

import { cn } from "@workspace/ui/lib/utils"

import { useShellExecutions } from "@/hooks/use-shell-executions"
import { useShellTasksPanelStore } from "@/stores/shell-tasks-panel-store"

/**
 * 正文下方「N 个后台命令运行中 · 查看」inline 小字超链接。
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
    <div className={cn("text-center", className)}>
      <button
        type="button"
        onClick={() => {
          if (onOpenShellTasks) {
            onOpenShellTasks()
            return
          }
          useShellTasksPanelStore.getState().toggle()
        }}
        className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
      >
        <IconTerminal2 className="size-3 shrink-0 animate-pulse" />
        <span>{count} 个后台命令运行中 · 查看</span>
      </button>
    </div>
  )
}
