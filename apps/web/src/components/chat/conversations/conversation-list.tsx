import { type ComponentProps } from "react"
import { IconCirclePlus, IconX } from "@tabler/icons-react"
import { useShallow } from "zustand/react/shallow"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { useConversationsQuery } from "@/hooks/use-chat-queries"
import { useCreateCuratorConversation } from "@/hooks/use-create-curator-conversation"
import type { CuratorConversationSelectScope } from "@/lib/chat/curator-conversation-actions"
import { getContactId } from "@/lib/chat/contact-utils"
import {
  getEmployeeDeepLinkConversationId,
  isPreservedEmployeeConversationSelection,
  selectConversationById,
} from "@/lib/chat/conversation-selection"
import { useChatStore } from "@/stores/chat-store"
import type { Contact } from "@/types/chat"
import { EmployeeContactAvatar } from "../contacts/contact-avatars"
import { ConversationItem } from "./conversation-item"

/**
 * 列表查询/缓存用的 contactId。
 *
 * 固定联系人（contactOverride，如总管侧栏/工作台总管面板）必须用**带前缀**的
 * contactId（curator:5），与 create / delete / ensure 写缓存的 key 一致。
 * 用裸 id（5）会与前缀 key desync：新建对话写在 curator:5、列表读 5 → 列表不刷新；
 * 删除后 focusAfterDeletedConversation 从 curator:5 读 remaining → 选不到下一条 → 不跳转。
 * 无 override 时跟随全局 selectedContactId（已是带前缀形态）。
 */
export function resolveListContactId(
  contactOverride: Contact | undefined,
  selectedContactId: string | null
): string | null {
  return contactOverride ? getContactId(contactOverride) : selectedContactId
}

export function ConversationList({
  className,
  hideNewButton,
  onSelectConversation,
  onClose,
  contactOverride,
  selectedConversationIdOverride,
  onSelectConversationId,
  createConversationSelectScope,
  hideHeader,
  searchQuery,
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
  /** 隐藏顶部联系人头部（外层已有工具栏时用，如对话侧边栏） */
  hideHeader?: boolean
  /** 按标题过滤会话（对话侧边栏搜索） */
  searchQuery?: string
}) {
  const { selectedContactId, selectedConversationId } = useChatStore(
    useShallow((state) => ({
      selectedContactId: state.selectedContactId,
      selectedConversationId: state.selectedConversationId,
    }))
  )
  const selectedContactFromStore = useChatStore((s) => s.getSelectedContact())
  const selectedContact = contactOverride ?? selectedContactFromStore
  const activeContactId = resolveListContactId(contactOverride, selectedContactId)
  const activeConversationId =
    selectedConversationIdOverride ?? selectedConversationId
  const { createCuratorConversation, isPending: isCreatingCurator } =
    useCreateCuratorConversation()

  const { data: conversations = [], isPending: conversationsPending } =
    useConversationsQuery(activeContactId, selectedContact)

  const q = (searchQuery ?? "").trim().toLowerCase()
  const visibleConversations = q
    ? conversations.filter((c) => (c.title ?? "").toLowerCase().includes(q))
    : conversations

  const deepLinkConversationId = getEmployeeDeepLinkConversationId(
    selectedContactId,
    selectedConversationId
  )
  // 深链幽灵行只在「列表跟随全局选中」(无 contactOverride)时显示。
  // 总管侧栏/工作台总管面板用 contactOverride=curator 列总管会话，深链进的是
  // 员工执行会话，与这些列表无关——否则会冒出一条「任务执行 #N」幽灵记录。
  const showDeepLinkInList =
    !contactOverride &&
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
      {!hideHeader && (
        <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
          {selectedContact ? (
            <div className="flex min-w-0 flex-1 items-center gap-2">
              {selectedContact.type === "curator" ? (
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
                  {selectedContact.type === "curator"
                    ? selectedContact.curator?.name
                    : selectedContact.employee?.name}
                </h2>
                <p className="truncate text-xs text-muted-foreground">
                  {selectedContact.type === "curator"
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
      )}

      {/* 阶段4：员工单聊退场，新建会话仅总管可用 */}
      {!hideNewButton && selectedContact?.type === "curator" && (
        <Button
          className="m-2"
          variant="outline"
          disabled={isCreatingCurator}
          onClick={() => {
            void createCuratorConversation(selectedContact, undefined, {
              selectScope: createConversationSelectScope,
            }).then(() => {
              onSelectConversation?.()
            })
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
          {!q && showDeepLinkInList && deepLinkConversationId != null ? (
            <ConversationItem
              key={`deep-link-${deepLinkConversationId}`}
              conversation={{
                id: deepLinkConversationId,
                title: `任务执行 #${deepLinkConversationId}`,
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
          {visibleConversations.map((conversation) => (
            <ConversationItem
              key={conversation.id}
              conversation={conversation}
              isSelected={
                String(activeConversationId) === String(conversation.id)
              }
              onClick={() => {
                if (onSelectConversationId) {
                  onSelectConversationId(conversation.id)
                } else {
                  selectConversationById(conversation.id)
                }
                onSelectConversation?.()
              }}
            />
          ))}
          {activeContactId &&
            !conversationsPending &&
            visibleConversations.length === 0 &&
            (q ? (
              <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
                <p className="text-xs">没有匹配的对话</p>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
                <p className="text-xs">暂无会话记录</p>
                <p className="mt-1 text-xs">点右上「+」开始新对话</p>
              </div>
            ))}
        </div>
      </div>
    </div>
  )
}
