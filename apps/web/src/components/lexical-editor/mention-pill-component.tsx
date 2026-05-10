import { cn } from "@workspace/ui/lib/utils"

export function MentionPillComponent({
  mentionName,
}: {
  mentionName: string
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-md bg-blue-500/10 px-2 py-0.5 text-xs font-medium text-blue-600",
        "align-middle select-none"
      )}
      contentEditable={false}
    >
      <span className="text-blue-600/60">@</span>
      {mentionName}
    </span>
  )
}
