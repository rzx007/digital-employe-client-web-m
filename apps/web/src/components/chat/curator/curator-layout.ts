import { cn } from "@workspace/ui/lib/utils"

export type CuratorViewSize = "default" | "compact"

export function getCuratorLayout(size: CuratorViewSize) {
  const isCompact = size === "compact"
  return {
    message: cn(
      "mx-auto w-full",
      isCompact ? "max-w-full" : "max-w-4xl",
    ),
    conversationContent: cn("space-y-3", isCompact && "px-1"),
    footer: cn(
      "mx-auto w-full border-none",
      isCompact ? "max-w-full px-2 py-2" : "max-w-4xl py-4",
    ),
    emptyWelcomeInner: cn(
      "mx-auto flex w-full min-w-0 flex-col items-center",
      isCompact ? "max-w-full" : "max-w-4xl",
    ),
  }
}
