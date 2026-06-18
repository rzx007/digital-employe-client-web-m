import * as React from "react"
import { IconCirclePlus, IconSearch } from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { cn } from "@workspace/ui/lib/utils"

import { getContactId } from "@/lib/chat/contact-utils"
import { selectConversationForContact } from "@/lib/chat/conversation-selection"
import { useCreateCuratorConversation } from "@/hooks/use-create-curator-conversation"
import { useChatStore } from "@/stores/chat-store"
import { WorkspaceSwitcher } from "../shell/workspace-switcher"

import { ConversationList } from "./conversation-list"

/**
 * 对话侧边栏（总管中心化）：列出总管的对话历史，顶部「搜索 + 新增对话」。
 * 取代旧的「最近联系人」侧栏——员工已退场单聊，改在「联系人」Tab 查看。
 */
export function ConversationSidebar({
  className,
  collapsed,
  ...props
}: React.ComponentProps<"div"> & { collapsed?: boolean }) {
  const [searchQuery, setSearchQuery] = React.useState("")
  const contacts = useChatStore((s) => s.contacts)
  const curator = React.useMemo(
    () => contacts.find((c) => c.type === "curator"),
    [contacts]
  )
  const { createCuratorConversation, isPending } =
    useCreateCuratorConversation()

  const handleNew = () => {
    if (!curator || isPending) return
    void createCuratorConversation(curator)
    useChatStore.getState().setActiveTab("chat")
  }

  const handleSelectConversation = (conversationId: string | number) => {
    if (!curator) return
    const id = getContactId(curator) ?? curator.curator?.id
    if (!id) return
    selectConversationForContact(id, conversationId)
    useChatStore.getState().setActiveTab("chat")
  }

  if (collapsed) {
    return (
      <div
        className={cn(
          "flex h-full min-h-0 flex-col items-center border-r bg-muted/50 py-2",
          className
        )}
        {...props}
      >
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={handleNew}
          disabled={isPending || !curator}
          title="新增对话"
          className="mb-1 shrink-0"
        >
          <IconCirclePlus className="size-5" />
        </Button>
        <ConversationList
          className="min-h-0 flex-1 bg-transparent"
          contactOverride={curator}
          collapsed
          hideHeader
          hideNewButton
          onSelectConversationId={handleSelectConversation}
        />
      </div>
    )
  }

  return (
    <div
      className={cn(
        "flex h-full min-h-0 w-full flex-col border-r bg-muted/50",
        className
      )}
      {...props}
    >
      <div className="border-b px-2 py-2">
        <WorkspaceSwitcher />
      </div>
      <div className="flex items-center gap-1.5 border-b px-3 py-4">
        <div className="relative flex-1">
          <IconSearch className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-7 border-none bg-background pl-7 text-xs"
            placeholder="搜索对话..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          className="h-7 w-7 shrink-0"
          onClick={handleNew}
          disabled={isPending || !curator}
          title="新增对话"
          data-tour-id="add-button"
        >
          <IconCirclePlus className="size-5" />
        </Button>
      </div>

      <ConversationList
        className="min-h-0 flex-1 bg-transparent"
        contactOverride={curator}
        searchQuery={searchQuery}
        hideHeader
        hideNewButton
        onSelectConversationId={handleSelectConversation}
      />
    </div>
  )
}
