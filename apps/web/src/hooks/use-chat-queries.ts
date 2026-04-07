import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { deleteConversation as deleteConversationApi } from "@/api/conversation"
import { fetchEmployeeById } from "@/api/employee"
import { fetchGroupById } from "@/api/group"
import {
  createConversation,
  fetchContacts,
  fetchConversationsByContactId,
  fetchMessagesByConversationId,
} from "@/api/chat"
import type { Contact } from "@/lib/mock-data/ai-employees"
import type { Conversation } from "@/lib/mock-data/conversations"
import type { Message } from "@/lib/mock-data/messages"
import { chatKeys } from "@/lib/query-keys/chat"

export function useContactsQuery() {
  return useQuery({
    queryKey: chatKeys.contacts(),
    queryFn: fetchContacts,
  })
}

export function useConversationsQuery(
  contactId: string | null,
  contact?: Contact | undefined
) {
  return useQuery({
    queryKey: chatKeys.conversations(contactId ?? ""),
    queryFn: () => fetchConversationsByContactId(contactId!, contact),
    enabled:
      Boolean(contactId) && Boolean(contact) && contact?.type !== "curator",
  })
}

export function useMessagesQuery(conversationId: string | number | null) {
  return useQuery({
    queryKey: chatKeys.messages(String(conversationId ?? "")),
    queryFn: () => fetchMessagesByConversationId(conversationId!),
    enabled: Boolean(conversationId),
  })
}

export function useCreateConversationMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: createConversation,
    onSuccess: (conversation) => {
      queryClient.setQueryData<Conversation[]>(
        chatKeys.conversations(conversation.contactId),
        (current) => {
          if (!current) {
            return [conversation]
          }

          const filtered = current.filter((item) => item.id !== conversation.id)
          return [conversation, ...filtered]
        }
      )
      queryClient.setQueryData<Message[]>(
        chatKeys.messages(conversation.id),
        []
      )
    },
  })
}

export function useEmployeeDetailQuery(id: string | null) {
  return useQuery({
    queryKey: chatKeys.employee(id ?? ""),
    queryFn: () => fetchEmployeeById(Number(id!)),
    enabled: Boolean(id),
    select: (res) => res.data,
  })
}

export function useGroupDetailQuery(id: string | null) {
  return useQuery({
    queryKey: chatKeys.group(id ?? ""),
    queryFn: () => fetchGroupById(Number(id!)),
    enabled: Boolean(id),
    select: (res) => res.data,
  })
}

export function useDeleteConversationMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      conversationId,
    }: {
      conversationId: string
      contactId: string
    }) => deleteConversationApi(conversationId),
    onMutate: async ({ conversationId, contactId }) => {
      await queryClient.cancelQueries({
        queryKey: chatKeys.conversations(contactId),
      })

      const previousConversations = queryClient.getQueryData<Conversation[]>(
        chatKeys.conversations(contactId)
      )

      queryClient.setQueryData<Conversation[]>(
        chatKeys.conversations(contactId),
        (current) => current?.filter((c) => c.id !== conversationId)
      )

      return { previousConversations, contactId }
    },
    onError: (_error, _variables, context) => {
      if (context?.previousConversations) {
        queryClient.setQueryData(
          chatKeys.conversations(context.contactId),
          context.previousConversations
        )
      }
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({
        queryKey: chatKeys.conversations(variables.contactId),
      })
    },
  })
}
