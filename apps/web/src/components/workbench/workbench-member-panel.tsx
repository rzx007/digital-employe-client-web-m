import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"
import { ConversationChatView } from "@/components/chat/views/chat-conversation-view"
import { getContactId } from "@/lib/chat/contact-utils"
import { useConversationsQuery } from "@/hooks/use-chat-queries"
import { ensureEmployeeConversation } from "@/lib/chat/ensure-employee-conversation"
import { chatKeys } from "@/lib/query-keys/chat"
import type { Contact, Conversation } from "@/types/chat"
import { cn } from "@workspace/ui/lib/utils"

/**
 * 工作台成员对话面板：给定一个员工 contact，自动取/建该员工的一条会话并渲染员工对话视图。
 * 用 ConversationChatView（正常员工聊天同款，身份/欢迎语/引导词都按员工显示），
 * 不再复用 CuratorView（其展示层硬编码为「总管助手」+总管引导词）。
 */
export function WorkbenchMemberPanel({
  contact,
  className,
}: {
  contact: Contact
  className?: string
}) {
  const queryClient = useQueryClient()
  const contactId = getContactId(contact)
  const { data: conversations = [], isSuccess } = useConversationsQuery(
    contactId,
    contact
  )

  const [createdId, setCreatedId] = React.useState<string | number | null>(null)

  // 无会话时建一条。用模块级去重的 ensureEmployeeConversation（跨重挂载存活，
  // 避免组件 ref 在父组件重渲染churn下被重置导致永不创建/重复创建）。
  React.useEffect(() => {
    if (!isSuccess) return
    if (conversations.length > 0) return
    if (createdId != null) return
    if (contact.type !== "employee" || !contact.employee?.id) return

    let cancelled = false
    void ensureEmployeeConversation(contact)
      .then((conv: Conversation) => {
        if (cancelled || !contactId) return
        // 写入会话列表缓存，让 useConversationsQuery 立即看到新会话（不等下次 refetch）。
        queryClient.setQueryData<Conversation[]>(
          chatKeys.conversations(contactId),
          (current) => {
            if (!current || current.length === 0) return [conv]
            if (current.some((c) => String(c.id) === String(conv.id)))
              return current
            return [conv, ...current]
          }
        )
        queryClient.setQueryData(chatKeys.messages(String(conv.id)), [])
        setCreatedId(conv.id)
      })
      .catch(() => {
        /* ensure 失败：保持占位，下次 effect 再试 */
      })
    return () => {
      cancelled = true
    }
  }, [
    isSuccess,
    conversations.length,
    createdId,
    contact,
    contactId,
    queryClient,
  ])

  // 派生当前激活会话：列表第一条；列表空则用刚建的。
  const activeId = React.useMemo<string | number | null>(() => {
    if (conversations.length > 0) return conversations[0].id
    return createdId
  }, [conversations, createdId])

  const conversationTitle = React.useMemo(() => {
    if (activeId == null) return undefined
    return (
      conversations.find((c) => String(c.id) === String(activeId))?.title ??
      "工作台对话"
    )
  }, [activeId, conversations])

  if (activeId == null) {
    return (
      <div
        className={cn(
          "flex h-full items-center justify-center text-xs text-muted-foreground",
          className
        )}
      >
        加载会话…
      </div>
    )
  }

  return (
    <ConversationChatView
      key={String(activeId)}
      contact={contact}
      conversationId={activeId}
      title={conversationTitle ?? "工作台对话"}
      className={cn("h-full min-h-0", className)}
    />
  )
}
