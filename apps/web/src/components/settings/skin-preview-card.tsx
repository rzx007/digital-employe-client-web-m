import { IconCheck } from "@tabler/icons-react"
import { cn } from "@workspace/ui/lib/utils"
import type { SkinOption } from "@/lib/theme/skins"

/**
 * 皮肤预览卡：局部 data-theme + 基调 class 作用域，渲染一段迷你 UI。
 * 约束：迷你 UI 只用语义令牌工具类，禁止任何 dark: 变体——
 * 否则亮皮肤卡在全局暗色下 dark: 会被祖先 .dark 误触发。
 */
export function SkinPreviewCard({
  skin,
  active,
  onSelect,
}: {
  skin: SkinOption
  active: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="group flex flex-col items-center gap-2 focus-visible:outline-none"
    >
      <div
        data-theme={skin.id}
        className={cn(
          skin.basis, // 局部 .light / .dark 基调
          "relative h-[120px] w-full overflow-hidden rounded-lg ring-1 transition-all",
          active
            ? "ring-2 ring-primary"
            : "ring-border/50 group-hover:ring-border"
        )}
      >
        <div className="flex h-full w-full bg-background">
          <div className="flex w-1/3 flex-col gap-1 bg-sidebar p-1.5">
            <div className="h-1.5 w-3/4 rounded-full bg-sidebar-primary" />
            <div className="h-1 w-full rounded-full bg-muted" />
            <div className="h-1 w-2/3 rounded-full bg-muted" />
          </div>
          <div className="flex flex-1 flex-col gap-1.5 p-1.5">
            <div className="h-6 rounded-md bg-card" />
            <div className="h-1.5 w-1/2 rounded-full bg-primary" />
            <div className="h-1 w-full rounded-full bg-muted" />
            <div className="h-1 w-4/5 rounded-full bg-muted" />
          </div>
        </div>
        {active && (
          <div className="absolute right-1 top-1 z-10 flex size-4 items-center justify-center rounded-full bg-primary">
            <IconCheck className="size-2.5 text-primary-foreground" />
          </div>
        )}
      </div>
      <span
        className={cn(
          "text-xs font-medium transition-colors",
          active
            ? "text-foreground"
            : "text-muted-foreground group-hover:text-foreground"
        )}
      >
        {skin.name}
      </span>
    </button>
  )
}
