import { ConversationEmptyState } from "@workspace/ui/components/ai-elements/conversation"
import { cn } from "@workspace/ui/lib/utils"
import { EmployeeContactAvatar } from "../contacts/contact-avatars"
import type { ChatViewContact } from "../shared/chat-view-shared"
import { GuidanceSuggestions } from "./guidance-suggestions"
import { getCuratorLayout } from "./curator-layout"

export function CuratorEmptyWelcome({
  contact,
  displayName,
  onSuggestionSelect,
  suggestionsDisabled = false,
  size = "default",
}: {
  contact?: ChatViewContact
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
        isCompact ? "gap-4 py-10" : "gap-6 py-16",
      )}
    >
      <div
        className={cn(
          layout.emptyWelcomeInner,
          isCompact ? "gap-4" : "gap-6",
        )}
      >
        {contact?.type === "curator" ? (
          <EmployeeContactAvatar
            name={contact.curator?.name ?? displayName}
            avatar={contact.curator?.avatar}
            status={contact.curator?.status}
            avatarClassName={isCompact ? "size-12" : "size-14"}
            fallbackClassName={isCompact ? "text-sm" : "text-base"}
          />
        ) : (
          <EmployeeContactAvatar
            name={displayName}
            avatar={undefined}
            avatarClassName={isCompact ? "size-12" : "size-14"}
            fallbackClassName={isCompact ? "text-sm" : "text-base"}
          />
        )}
        <div className="space-y-2 text-center">
          <h2
            className={cn(
              "font-semibold tracking-tight",
              isCompact ? "text-sm" : "text-md",
            )}
          >
            你好，我是{displayName}
          </h2>
          <p
            className={cn(
              "text-muted-foreground",
              isCompact ? "text-xs" : "text-sm",
            )}
          >
            用自然语言描述目标，我会拆解任务并分派给数字员工；输入 @
            可指定经办人
          </p>
        </div>
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
