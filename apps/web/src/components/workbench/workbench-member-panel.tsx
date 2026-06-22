import * as React from "react"
import { CuratorView } from "@/components/chat/curator/curator-view"
import { getContactId } from "@/lib/chat/contact-utils"
import {
  useConversationsQuery,
  useCreateConversationMutation,
} from "@/hooks/use-chat-queries"
import { buildWorkbenchSnapshot } from "@/lib/workbench/workbench-context"
import type { Contact } from "@/types/chat"
import { cn } from "@workspace/ui/lib/utils"

/**
 * 工作台成员对话面板：给定一个员工 contact，自动取/建该员工的一条会话并渲染 CuratorView。
 * CuratorView 接受任意 contact，故复用之承载员工对话（无需单独 EmployeeView）。
 */
export function WorkbenchMemberPanel({
  contact,
  resourcesOpen,
  onToggleResources,
  onOpenResourceFile,
  className,
}: {
  contact: Contact
  resourcesOpen?: boolean
  onToggleResources?: () => void
  onOpenResourceFile?: (path: string) => void
  className?: string
}) {
  const contactId = getContactId(contact)
  const { data: conversations = [], isSuccess } = useConversationsQuery(
    contactId,
    contact
  )
  const createConversation = useCreateConversationMutation()

  const [createdId, setCreatedId] = React.useState<string | number | null>(null)
  const creatingRef = React.useRef(false)

  // 无会话时建一条（一次性，副作用只做"创建"这一外部动作，不在 effect 里同步派生 state）
  React.useEffect(() => {
    if (!isSuccess) return
    if (conversations.length > 0) return
    if (creatingRef.current || createdId != null) return
    const targetId = contact.employee?.id
    if (!targetId) return
    creatingRef.current = true
    createConversation.mutate(
      {
        target_type: "employee",
        target_id: Number(targetId),
        title: "工作台对话",
      },
      {
        onSuccess: (res) => {
          const newId = res?.data?.id
          if (newId != null) setCreatedId(newId)
          creatingRef.current = false
        },
        onError: () => {
          creatingRef.current = false
        },
      }
    )
  }, [
    isSuccess,
    conversations.length,
    createdId,
    contact.employee?.id,
    createConversation,
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
    <CuratorView
      key={String(activeId)}
      contact={contact}
      conversationId={activeId}
      title={conversationTitle}
      size="compact"
      className={cn("h-full min-h-0", className)}
      resourcesOpen={resourcesOpen}
      onToggleResources={onToggleResources}
      onOpenResourceFile={onOpenResourceFile}
      getExtraMetadata={() => ({ workbench: buildWorkbenchSnapshot() })}
    />
  )
}
