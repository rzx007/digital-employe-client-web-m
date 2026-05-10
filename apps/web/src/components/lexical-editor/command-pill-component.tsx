import { cn } from "@workspace/ui/lib/utils"

export function CommandPillComponent({
  commandTitle,
}: {
  commandTitle: string
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary",
        "align-middle select-none"
      )}
      contentEditable={false}
    >
      /{commandTitle}
    </span>
  )
}
