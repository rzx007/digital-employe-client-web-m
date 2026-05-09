import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { deleteConversation as deleteConversationApi } from "@/api/conversation"
import {
  fetchEmployeeById,
  updateEmployee,
  type CreateEmployeeParams,
} from "@/api/employee"
import { fetchGroupById } from "@/api/group"
import {
  createConversation,
  fetchContacts,
  fetchConversationsByContactId,
  fetchMessagesByConversationId,
} from "@/api/chat"
import {
  fetchConversationResources,
  fetchResourceContent,
  fetchCuratorConversation,
  deleteAllTaskExecutions,
  uploadConversationFile,
} from "@/api/conversation"
import type { Contact } from "@/lib/mock-data/ai-employees"
import type { Conversation } from "@/lib/mock-data/conversations"
import type { Message } from "@/lib/mock-data/messages"
import { chatKeys } from "@/lib/query-keys/chat"

export function useContactsQuery() {
  return useQuery({
    queryKey: chatKeys.contacts(),
    queryFn: ({ signal }) => fetchContacts(signal),
  })
}

export function useConversationsQuery(
  contactId: string | null,
  contact?: Contact | undefined
) {
  return useQuery({
    queryKey: chatKeys.conversations(contactId ?? ""),
    queryFn: ({ signal }) =>
      fetchConversationsByContactId(contactId!, contact, { signal }),
    enabled:
      Boolean(contactId) && Boolean(contact),
  })
}

export function useMessagesQuery(conversationId: string | number | null) {
  return useQuery({
    queryKey: chatKeys.messages(String(conversationId ?? "")),
    queryFn: ({ signal }) =>
      fetchMessagesByConversationId(conversationId!, { signal }),
    enabled: Boolean(conversationId),
    staleTime: 1000 * 60 * 0,
  })
}

export function useCuratorConversationQuery() {
  return useQuery({
    queryKey: chatKeys.curator(),
    queryFn: async ({ signal }) => {
      const res = await fetchCuratorConversation({ signal })
      return res?.data ?? null
    },
    staleTime: Infinity,
  })
}

export function useOrchestrationPlansQuery() {
  return useQuery({
    queryKey: [...chatKeys.all, "orchestration-plans"],
    queryFn: async ({ signal }) => {
      const { request } = await import("@/lib/request")
      const res = await request<{ code: number; data: Array<{ id: number; workspace_id: number; conversation_id: number; user_input: string; plan_json: string; status: string; total_tasks: number; completed_tasks: number; created_at: string; updated_at: string }> }>(
        "/orchestration/plans?workspace_id=1",
        { signal },
      )
      return res?.data ?? []
    },
    refetchInterval: 5000,
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
    queryFn: ({ signal }) =>
      fetchEmployeeById(Number(id!), { signal }),
    enabled: Boolean(id),
    select: (res) => res.data,
  })
}

export function useGroupDetailQuery(id: string | null) {
  return useQuery({
    queryKey: chatKeys.group(id ?? ""),
    queryFn: ({ signal }) =>
      fetchGroupById(Number(id!), { signal }),
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

export function useResetCuratorConversation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ conversationId, clearTaskLogs }: {
      conversationId: number | string
      clearTaskLogs?: boolean
    }) => {
      const promises: Promise<unknown>[] = [deleteConversationApi(conversationId)]
      if (clearTaskLogs) {
        promises.push(deleteAllTaskExecutions())
      }
      await Promise.all(promises)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: chatKeys.curator() })
      queryClient.invalidateQueries({ queryKey: [...chatKeys.all, "all-task-executions"] })
    },
  })
}

export function useUpdateEmployeeMutation(employeeId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (params: CreateEmployeeParams) =>
      updateEmployee(employeeId, params),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: chatKeys.employee(employeeId),
      })
      queryClient.invalidateQueries({
        queryKey: chatKeys.contacts(),
      })
    },
  })
}

export function useConversationResourcesQuery(conversationId: string | number | null) {
  return useQuery({
    queryKey: chatKeys.resources(String(conversationId)),
    queryFn: async ({ signal }) => {
      const res = await fetchConversationResources(conversationId!, { signal })
      return res.data
    },
    enabled: !!conversationId,
  })
}

export function useResourceContentQuery(
  conversationId: string | number,
  path: string | null,
) {
  return useQuery({
    queryKey: chatKeys.resourceContent(String(conversationId), path ?? ""),
    queryFn: async ({ signal }) => {
      const res = await fetchResourceContent(conversationId, path!, { signal })
      return res.data
    },
    enabled: !!path,
  })
}

export function useUploadFileMutation(conversationId: string | number | null) {
  return useMutation({
    mutationFn: async (file: File) => {
      if (!conversationId) throw new Error("缺少会话 ID")
      const res = await uploadConversationFile(conversationId, file)
      if (!res?.data) throw new Error(res?.msg || "上传失败")
      return res.data
    },
  })
}
