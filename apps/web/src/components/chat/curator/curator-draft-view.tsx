import * as React from "react"
import type { PromptInputMessage } from "@workspace/ui/components/ai-elements/prompt-input"
import { useCreateConversationMutation } from "@/hooks/use-chat-queries"
import { useChatStore } from "@/stores/chat-store"
import { toast } from "sonner"
import type { ChatViewContact } from "../chat-view-shared"
import { ChatPanel } from "../chat-panel"

export function CuratorDraftView({
  contact,
  onOpenContacts,
  onOpenConversations,
  onNewConversation,
  className,
}: React.ComponentProps<"div"> & {
  contact?: ChatViewContact
  onOpenContacts?: () => void
  onOpenConversations?: () => void
  onNewConversation?: () => void
}) {
  const [inputValue, setInputValue] = React.useState("")
  const selectedContactId = useChatStore((s) => s.selectedContactId)
  const setSelectedConversationId = useChatStore(
    (s) => s.setSelectedConversationId
  )
  const selectedContact = useChatStore((s) => s.getSelectedContact())
  const createConversationMutation = useCreateConversationMutation()

  const handleSend = React.useCallback(
    async (message: PromptInputMessage) => {
      const text = message.text?.trim() ?? ""
      if (!text) return

      try {
        const created = await createConversationMutation.mutateAsync({
          contactId: selectedContactId ?? "",
          title: text.slice(0, 50),
          contact: selectedContact,
        })
        setSelectedConversationId(created.id)
        setInputValue("")
      } catch (err) {
        toast.error("创建对话失败", {
          description: err instanceof Error ? err.message : undefined,
        })
      }
    },
    [
      selectedContactId,
      selectedContact,
      createConversationMutation,
      setSelectedConversationId,
    ]
  )

  return (
    <ChatPanel
      contact={contact}
      title="总管助手"
      messages={[]}
      inputValue={inputValue}
      status="ready"
      isDraftMode
      isMessagesLoading={false}
      isSubmitDisabled={!inputValue.trim()}
      onInputChange={(e) => setInputValue(e.value)}
      onSend={handleSend}
      onOpenContacts={onOpenContacts}
      onOpenConversations={onOpenConversations}
      onNewConversation={onNewConversation}
      className={className}
    />
  )
}
