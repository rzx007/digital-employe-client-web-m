import {
  IconChevronDown,
  IconChevronUp,
  IconPlayerPlay,
  IconX,
} from "@tabler/icons-react"
import { cn } from "@workspace/ui/lib/utils"
import type { PendingMessage } from "@/hooks/use-pending-messages"

interface PendingMessageQueueProps {
  queue: PendingMessage[]
  onRemove: (id: string) => void
  onSendNow: (id: string) => void
  onMoveUp: (id: string) => void
  onMoveDown: (id: string) => void
}

export function PendingMessageQueue({
  queue,
  onRemove,
  onSendNow,
  onMoveUp,
  onMoveDown,
}: PendingMessageQueueProps) {
  if (queue.length === 0) return null

  return (
    <div className="space-y-0 border rounded-md pb-3 -mb-3.5">
      {queue.map((item, idx) => (
        <PendingMessageCard
          key={item.id}
          item={item}
          isFirst={idx === 0}
          isLast={idx === queue.length - 1}
          onRemove={onRemove}
          onSendNow={onSendNow}
          onMoveUp={onMoveUp}
          onMoveDown={onMoveDown}
        />
      ))}
    </div>
  )
}

function PendingMessageCard({
  item,
  isFirst,
  isLast,
  onRemove,
  onSendNow,
  onMoveUp,
  onMoveDown,
}: {
  item: PendingMessage
  isFirst: boolean
  isLast: boolean
  onRemove: (id: string) => void
  onSendNow: (id: string) => void
  onMoveUp: (id: string) => void
  onMoveDown: (id: string) => void
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 border-b border-border/50 bg-muted/40 px-2.5 py-1.5",
        "animate-in fade-in slide-in-from-bottom-1 duration-200"
      )}
    >
      <span className="flex-1 truncate text-xs text-foreground/80">
        {item.text}
      </span>
      <div className="flex shrink-0 items-center gap-0.5">
        <ActionButton
          icon={<IconChevronUp className="size-3" />}
          disabled={isFirst}
          onClick={() => onMoveUp(item.id)}
          title="上移"
        />
        <ActionButton
          icon={<IconChevronDown className="size-3" />}
          disabled={isLast}
          onClick={() => onMoveDown(item.id)}
          title="下移"
        />
        <ActionButton
          icon={<IconPlayerPlay className="size-3" />}
          onClick={() => onSendNow(item.id)}
          title="立刻发送"
        />
        <ActionButton
          icon={<IconX className="size-3" />}
          onClick={() => onRemove(item.id)}
          title="移除"
        />
      </div>
    </div>
  )
}

function ActionButton({
  icon,
  onClick,
  disabled,
  title,
}: {
  icon: React.ReactNode
  onClick: () => void
  disabled?: boolean
  title?: string
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      className={cn(
        "inline-flex items-center justify-center rounded p-0.5",
        "text-muted-foreground/60 hover:text-foreground hover:bg-muted/80",
        "transition-colors disabled:opacity-30 disabled:pointer-events-none"
      )}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
    >
      {icon}
    </button>
  )
}
