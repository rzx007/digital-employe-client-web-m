import * as React from "react"
import { toast } from "sonner"

import { Switch } from "@workspace/ui/components/switch"
import { cn } from "@workspace/ui/lib/utils"

/**
 * 群「自动确认成员任务」开关。
 *
 * 开启后：成员（@ 直接派活）触发的非澄清类审批（文档方案确认等执行类 HITL）自动
 * 放行，群任务全自动跑通；组长的「澄清提问」不受影响，仍需用户作答。默认关。
 */
export function GroupAutoConfirmToggle({
  enabled,
  onChange,
  className,
}: {
  enabled: boolean
  onChange: (enabled: boolean) => Promise<void> | void
  className?: string
}) {
  const [pending, setPending] = React.useState(false)
  const id = React.useId()

  const handleChange = async (next: boolean) => {
    if (pending) return
    setPending(true)
    try {
      await onChange(next)
    } catch {
      toast.error("切换自动确认失败")
    } finally {
      setPending(false)
    }
  }

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-2 rounded-lg border bg-muted/30 px-3 py-2",
        className
      )}
    >
      <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
        <span className="block text-xs font-medium">自动确认成员任务</span>
        <span className="block text-[10px] leading-tight text-muted-foreground">
          成员执行类审批自动放行；澄清提问仍需你作答
        </span>
      </label>
      <Switch
        id={id}
        checked={enabled}
        disabled={pending}
        onCheckedChange={(v) => {
          void handleChange(v)
        }}
      />
    </div>
  )
}
