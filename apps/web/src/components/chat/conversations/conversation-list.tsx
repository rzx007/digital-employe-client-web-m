import { type ComponentProps } from "react"
import { IconCirclePlus, IconX } from "@tabler/icons-react"
import { useShallow } from "zustand/react/shallow"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { useConversationsQuery } from "@/hooks/use-chat-queries"
import { useCreateCuratorConversation } from "@/hooks/use-create-curator-conversation"
import type { CuratorConversationSelectScope } from "@/lib/chat/curator-conversation-actions"
import {
  enterDraftConversation,
  getEmployeeDeepLinkConversationId,
  isPreservedEmployeeConversationSelection,
  selectConversationById,
} from "@/lib/chat/conversation-selection"
import { touchRecentContactById } from "@/lib/chat/touch-recent-contact"
import { useChatStore } from "@/stores/chat-store"
import type { Contact } from "@/types/chat"
import {
  EmployeeContactAvatar,
  GroupMembersAvatar,
} from "../contacts/contact-avatars"
import { ConversationItem } from "./conversation-item"

export function ConversationList({
  className,
  hideNewButton,
  onSelectConversation,
  onClose,
  contactOverride,
  selectedConversationIdOverride,
  onSelectConversationId,
  createConversationSelectScope,
  ...props
}: ComponentProps<"div"> & {
  hideNewButton?: boolean
  onSelectConversation?: () => void
  onClose?: () => void
  /** 固定展示某联系人会话（如工作台总管侧栏），不读全局 selectedContactId */
  contactOverride?: Contact
  selectedConversationIdOverride?: string | number | null
  onSelectConversationId?: (conversationId: string | number) => void
  createConversationSelectScope?: CuratorConversationSelectScope
}) {
  const { selectedContactId, selectedConversationId } = useChatStore(
    useShallow((state) => ({
      selectedContactId: state.selectedContactId,
      selectedConversationId: state.selectedConversationId,
    }))
  )
  const selectedContactFromStore = useChatStore((s) => s.getSelectedContact())
  const selectedContact = contactOverride ?? selectedContactFromStore
  const activeContactId =
    contactOverride?.type === "curator"
      ? contactOverride.curator?.id ?? null
      : contactOverride?.type === "employee"
        ? contactOverride.employee?.id ?? null
        : contactOverride?.type === "group"
          ? contactOverride.group?.id ?? null
          : selectedContactId
  const activeConversationId =
    selectedConversationIdOverride ?? selectedConversationId
  const { createCuratorConversation, isPending: isCreatingCurator } =
    useCreateCuratorConversation()

  const { data: conversations = [], isPending: conversationsPending } =
    useConversationsQuery(activeContactId, selectedContact)

  const deepLinkConversationId = getEmployeeDeepLinkConversationId(
    selectedContactId,
    selectedConversationId
  )
  const showDeepLinkInList =
    deepLinkConversationId != null &&
    isPreservedEmployeeConversationSelection(
      selectedContactId,
      selectedConversationId,
      conversations
    )

  return (
    <div
      className={cn(
        "flex h-full min-h-0 w-full flex-col bg-background",
        className
      )}
      {...props}
    >
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        {selectedContact ? (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {selectedContact.type === "group" ? (
              <GroupMembersAvatar
                participants={selectedContact.group?.participants}
                className="h-8 w-8"
              />
            ) : selectedContact.type === "curator" ? (
              <EmployeeContactAvatar
                name={selectedContact.curator?.name}
                avatar={selectedContact.curator?.avatar}
                status={selectedContact.curator?.status}
                showStatus
              />
            ) : (
              <EmployeeContactAvatar
                name={selectedContact.employee?.name}
                avatar={selectedContact.employee?.avatar}
                status={selectedContact.employee?.status}
                showStatus
              />
            )}
            <div className="flex min-w-0 flex-col">
              <h2 className="truncate text-sm font-medium">
                {selectedContact.type === "group"
                  ? selectedContact.group?.name
                  : selectedContact.type === "curator"
                    ? selectedContact.curator?.name
                    : selectedContact.employee?.name}
              </h2>
              <p className="truncate text-xs text-muted-foreground">
                {selectedContact.type === "group"
                  ? `${selectedContact.group?.participants.length ?? 0} 位成员`
                  : selectedContact.type === "curator"
                    ? selectedContact.curator?.role
                    : selectedContact.employee?.role}
              </p>
            </div>
          </div>
        ) : (
          <h2 className="min-w-0 flex-1 text-sm font-medium">最近消息</h2>
        )}
        {onClose && (
          <Button
            variant="ghost"
            size="icon-sm"
            type="button"
            aria-label="关闭会话列表"
            className="shrink-0"
            onClick={onClose}
          >
            <IconX className="size-4" />
          </Button>
        )}
      </div>

      {!hideNewButton && (
        <Button
          className="m-2"
          variant="outline"
          disabled={isCreatingCurator}
          onClick={() => {
            if (selectedContact?.type === "curator") {
              void createCuratorConversation(selectedContact, undefined, {
                selectScope: createConversationSelectScope,
              }).then(() => {
                onSelectConversation?.()
              })
              return
            }
            enterDraftConversation()
            onSelectConversation?.()
          }}
        >
          <IconCirclePlus className="size-4" />
          新建会话
        </Button>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-0.5 p-2">
          {activeContactId && conversationsPending && (
            <div className="py-6 text-center text-xs text-muted-foreground">
              加载会话…
            </div>
          )}
          {showDeepLinkInList && deepLinkConversationId != null ? (
            <ConversationItem
              key={`deep-link-${deepLinkConversationId}`}
              conversation={{
                id: deepLinkConversationId,
                title: `群任务执行 #${deepLinkConversationId}`,
                contactId: String(activeContactId ?? ""),
                updatedAt: new Date(),
                unreadCount: 0,
              }}
              isSelected={
                String(activeConversationId) === String(deepLinkConversationId)
              }
              onClick={() => {
                if (onSelectConversationId) {
                  onSelectConversationId(deepLinkConversationId)
                } else {
                  selectConversationById(deepLinkConversationId)
                }
                onSelectConversation?.()
              }}
            />
          ) : null}
          {conversations.map((conversation) => (
            <ConversationItem
              key={conversation.id}
              conversation={conversation}
              isSelected={String(activeConversationId) === String(conversation.id)}
              onClick={() => {
                if (onSelectConversationId) {
                  onSelectConversationId(conversation.id)
                } else {
                  selectConversationById(conversation.id)
                }
                if (activeContactId) {
                  void touchRecentContactById(activeContactId)
                }
                onSelectConversation?.()
              }}
            />
          ))}
          {activeContactId &&
            !conversationsPending &&
            conversations.length === 0 && (
              <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
                <p className="text-xs">暂无会话记录</p>
                <p className="mt-1 text-xs">选择联系人开始聊天</p>
              </div>
            )}
        </div>
      </div>
    </div>
  )
}
