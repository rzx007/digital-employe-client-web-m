import { ConversationEmptyState } from "@workspace/ui/components/ai-elements/conversation"
import { cn } from "@workspace/ui/lib/utils"
import { GuidanceSuggestions } from "./guidance-suggestions"
import { CuratorTeamCard } from "./curator-team-card"
import { getCuratorLayout } from "./curator-layout"

export function CuratorEmptyWelcome({
  displayName,
  onSuggestionSelect,
  suggestionsDisabled = false,
  size = "default",
}: {
  displayName: string
  onSuggestionSelect: (text: string) => void
  suggestionsDisabled?: boolean
  size?: "default" | "compact"
}) {
  const isCompact = size === "compact"
  const layout = getCuratorLayout(size)

  return (
    <ConversationEmptyState
      className={cn(
        "w-full items-stretch px-4",
        isCompact ? "gap-4 py-10" : "gap-6 py-16"
      )}
    >
      <div
        className={cn(layout.emptyWelcomeInner, isCompact ? "gap-4" : "gap-6")}
      >
        <div className="space-y-2 text-center">
          <h2
            className={cn(
              "font-semibold tracking-tight",
              isCompact ? "text-sm" : "text-md"
            )}
          >
            你好，我是{displayName}
          </h2>
          <p
            className={cn(
              "text-muted-foreground",
              isCompact ? "text-xs" : "text-sm"
            )}
          >
            用自然语言描述目标，我会拆解任务并分派给数字员工；输入 @
            可指定经办人
          </p>
        </div>
        <CuratorTeamCard />
        <GuidanceSuggestions
          onSelect={onSuggestionSelect}
          disabled={suggestionsDisabled}
          compact={isCompact}
          className="w-full"
        />
      </div>
    </ConversationEmptyState>
  )
}
