import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import {
  fetchEmployeeById,
  updateEmployee,
  type CreateEmployeeParams,
} from "@/api/employee"
import { fetchGroupById } from "@/api/group"
import {
  createConversation,
  deleteAllConversationsForContact,
  deleteConversation as deleteConversationApi,
  deleteTaskExecutionsByOrchestratorConversation,
  fetchContacts,
  fetchConversationResources,
  fetchConversationsByContactId,
  fetchCuratorConversation,
  fetchMessagesByConversationId,
  fetchResourceContent,
  updateConversationTitle as updateConversationTitleApi,
  uploadConversationFile,
} from "@/api/chat"
import {
  deleteRecentContact,
  fetchRecentContacts,
  importRecentContacts,
  touchRecentContact,
  updateRecentContactPin,
} from "@/api/recent-contacts"
import type { Contact, Conversation, Message } from "@/types/chat"
import { mapContactToTarget } from "@/lib/chat/contact-target"
import { findContactInList, getContactId } from "@/lib/chat/contact-utils"
import {
  enterDraftConversation,
  selectConversationById,
} from "@/lib/chat/conversation-selection"
import { mapRecentContactDtoToItem } from "@/lib/chat/recent-contact-mappers"
import { resetChatRightPanels } from "@/lib/chat/reset-chat-right-panels"
import { chatKeys } from "@/lib/query-keys/chat"
import { getActiveWorkspaceId } from "@/lib/workspace-id"
import { useAuthStore } from "@/stores/auth-store"
import { useBrowserStore } from "@/stores/browser-store"
import { useChatStore } from "@/stores/chat-store"
import {
  buildRecentContactImportPayload,
  clearRecentConversationsStorage,
  hasRecentContactsImported,
  loadAndMigrateRecentConversations,
  markRecentContactsImported,
} from "@/components/chat/conversations/recent-conversations/persistence"
import type { RecentConversationItem } from "@/components/chat/conversations/recent-conversations/types"

export function useContactsQuery() {
  return useQuery({
    queryKey: chatKeys.contacts(),
    queryFn: ({ signal }) => fetchContacts(signal),
  })
}

export function useRecentContactsQuery() {
  const workspaceId = useAuthStore((s) => s.workspaceId) ?? getActiveWorkspaceId()

  return useQuery({
    queryKey: chatKeys.recentContacts(workspaceId),
    queryFn: async ({ signal }) => {
      const res = await fetchRecentContacts({ signal, workspaceId })
      let dtos = res?.data ?? []

      if (!hasRecentContactsImported(workspaceId)) {
        const local = loadAndMigrateRecentConversations(workspaceId)
        const importItems = buildRecentContactImportPayload(local)
        if (importItems.length > 0) {
          await importRecentContacts(importItems, { signal, workspaceId })
          clearRecentConversationsStorage(workspaceId)
          const retry = await fetchRecentContacts({ signal, workspaceId })
          dtos = retry?.data ?? []
        }
        markRecentContactsImported(workspaceId)
      }

      return dtos.map(mapRecentContactDtoToItem)
    },
    staleTime: 30_000,
  })
}

export function useTouchRecentContactMutation() {
  const queryClient = useQueryClient()
  const workspaceId = useAuthStore((s) => s.workspaceId) ?? getActiveWorkspaceId()

  return useMutation({
    mutationFn: (contact: Contact) => {
      const target = mapContactToTarget(contact)
      if (!target) {
        return Promise.reject(new Error("无法确定聊天目标类型"))
      }
      return touchRecentContact(target, { workspaceId })
    },
    onSuccess: () => {
      void queryClient.refetchQueries({
        queryKey: chatKeys.recentContacts(workspaceId),
      })
    },
  })
}

export function useToggleRecentPinMutation() {
  const queryClient = useQueryClient()
  const workspaceId = useAuthStore((s) => s.workspaceId) ?? getActiveWorkspaceId()

  return useMutation({
    mutationFn: ({
      contact,
      isPinned,
    }: {
      contact: Contact
      isPinned: boolean
    }) => {
      const target = mapContactToTarget(contact)
      if (!target) {
        return Promise.reject(new Error("无法确定聊天目标类型"))
      }
      return updateRecentContactPin(
        target.target_type,
        target.target_id,
        isPinned,
        { workspaceId }
      )
    },
    onSuccess: () => {
      void queryClient.refetchQueries({
        queryKey: chatKeys.recentContacts(workspaceId),
      })
    },
  })
}

export function useDeleteRecentContactMutation() {
  const queryClient = useQueryClient()
  const workspaceId = useAuthStore((s) => s.workspaceId) ?? getActiveWorkspaceId()

  return useMutation({
    mutationFn: (contact: Contact) => {
      const target = mapContactToTarget(contact)
      if (!target) {
        return Promise.reject(new Error("无法确定聊天目标类型"))
      }
      return deleteRecentContact(target.target_type, target.target_id, {
        workspaceId,
      })
    },
    onSuccess: (_data, contact) => {
      const contactId =
        contact.type === "curator"
          ? contact.curator?.id
          : contact.type === "employee"
            ? contact.employee?.id
            : contact.group?.id
      if (!contactId) return
      queryClient.setQueryData<RecentConversationItem[]>(
        chatKeys.recentContacts(workspaceId),
        (current) => current?.filter((i) => i.contactId !== contactId)
      )
    },
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
    enabled: Boolean(contactId) && Boolean(contact),
  })
}

export function useMessagesQuery(conversationId: string | number | null) {
  return useQuery({
    queryKey: chatKeys.messages(String(conversationId ?? "")),
    queryFn: ({ signal }) =>
      fetchMessagesByConversationId(conversationId!, { signal }),
    enabled: Boolean(conversationId),
    staleTime: 0,
    /** 切回会话时不用创建会话时写入的空缓存，始终拉最新 DB */
    refetchOnMount: "always",
    /**  refetch 期间保留上一份消息，避免切走再切回闪成空白 */
    placeholderData: (previous) => previous,
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

export function useOrchestrationPlansQuery(
  conversationId?: string | number | null
) {
  const convKey =
    conversationId != null ? String(conversationId) : null
  return useQuery({
    queryKey: chatKeys.orchestrationPlans(convKey),
    queryFn: async ({ signal }) => {
      const { request } = await import("@/lib/request")
      const qs =
        convKey != null
          ? `?conversation_id=${encodeURIComponent(convKey)}`
          : ""
      const res = await request<{
        code: number
        data: Array<{
          id: number
          workspace_id: number
          conversation_id: number
          user_input: string
          plan_json: string
          status: string
          total_tasks: number
          completed_tasks: number
          created_at: string
          updated_at: string
        }>
      }>(`/workspaces/1/orchestration/plans${qs}`, { signal })
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
      const workspaceId = useAuthStore.getState().workspaceId ?? getActiveWorkspaceId()
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
      void queryClient.refetchQueries({
        queryKey: chatKeys.recentContacts(workspaceId),
      })
    },
  })
}

export function useUpdateConversationTitleMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      conversationId,
      title,
    }: {
      conversationId: string | number
      title: string
      contactId: string
    }) => {
      const res = await updateConversationTitleApi(conversationId, title)
      if (!res?.data) {
        throw new Error("更新会话标题失败")
      }
      return res.data
    },
    onSuccess: (_data, variables) => {
      const workspaceId = useAuthStore.getState().workspaceId ?? getActiveWorkspaceId()
      queryClient.setQueryData<Conversation[]>(
        chatKeys.conversations(variables.contactId),
        (current) =>
          current?.map((item) =>
            String(item.id) === String(variables.conversationId)
              ? { ...item, title: variables.title }
              : item
          )
      )
      void queryClient.refetchQueries({
        queryKey: chatKeys.recentContacts(workspaceId),
      })
    },
  })
}

export function useEmployeeDetailQuery(id: string | null) {
  return useQuery({
    queryKey: chatKeys.employee(id ?? ""),
    queryFn: ({ signal }) => fetchEmployeeById(Number(id!), { signal }),
    enabled: Boolean(id),
    select: (res) => res.data,
  })
}

export function useGroupDetailQuery(id: string | null) {
  return useQuery({
    queryKey: chatKeys.group(id ?? ""),
    queryFn: ({ signal }) => fetchGroupById(Number(id!), { signal }),
    enabled: Boolean(id),
    select: (res) => res.data,
  })
}

export function useDeleteAllConversationsForContactMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      contactId,
      contact,
    }: {
      contactId: string
      contact: Contact
    }) => deleteAllConversationsForContact(contactId, contact),
    onSuccess: (deletedIds, { contactId, contact }) => {
      const workspaceId = useAuthStore.getState().workspaceId ?? getActiveWorkspaceId()
      const selectionContactId = getContactId(contact) ?? contactId
      queryClient.setQueryData<Conversation[]>(
        chatKeys.conversations(selectionContactId),
        []
      )
      if (selectionContactId !== contactId) {
        queryClient.setQueryData<Conversation[]>(
          chatKeys.conversations(contactId),
          []
        )
      }
      for (const id of deletedIds) {
        queryClient.removeQueries({ queryKey: chatKeys.messages(id) })
        queryClient.removeQueries({ queryKey: chatKeys.resources(id) })
      }
      queryClient.invalidateQueries({
        queryKey: chatKeys.conversations(selectionContactId),
      })
      const target = mapContactToTarget(contact)
      if (target) {
        void deleteRecentContact(target.target_type, target.target_id, {
          workspaceId,
        })
        queryClient.setQueryData<RecentConversationItem[]>(
          chatKeys.recentContacts(workspaceId),
          (current) => current?.filter((i) => i.contactId !== contactId)
        )
      }
      for (const id of deletedIds) {
        useBrowserStore.getState().clearBackground(String(id))
      }
      resetChatRightPanels()
    },
  })
}

export function useDeleteConversationMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      conversationId,
      contactId,
    }: {
      conversationId: string
      contactId: string
    }) => {
      const contact = findContactInList(
        useChatStore.getState().contacts,
        contactId
      )
      if (contact?.type === "curator") {
        await deleteTaskExecutionsByOrchestratorConversation(conversationId)
      }
      return deleteConversationApi(conversationId)
    },
    onMutate: async ({ conversationId, contactId }) => {
      await queryClient.cancelQueries({
        queryKey: chatKeys.conversations(contactId),
      })

      const previousConversations = queryClient.getQueryData<Conversation[]>(
        chatKeys.conversations(contactId)
      )

      queryClient.setQueryData<Conversation[]>(
        chatKeys.conversations(contactId),
        (current) =>
          current?.filter(
            (c) => String(c.id) !== String(conversationId)
          )
      )

      const remaining =
        queryClient.getQueryData<Conversation[]>(
          chatKeys.conversations(contactId)
        ) ?? []
      const contact = findContactInList(
        useChatStore.getState().contacts,
        contactId
      )
      const { selectedConversationId, isDraftConversation } =
        useChatStore.getState()
      const deletedId = String(conversationId)
      const targetsCurrentSelection =
        String(selectedConversationId) === deletedId ||
        (selectedConversationId == null && remaining.length === 0)

      if (
        targetsCurrentSelection &&
        contact?.type !== "curator"
      ) {
        const next = remaining[0]
        if (next) {
          selectConversationById(next.id)
        } else if (!isDraftConversation) {
          enterDraftConversation()
        }
      }

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
      const contact = findContactInList(
        useChatStore.getState().contacts,
        variables.contactId
      )
      if (contact?.type === "curator") {
        queryClient.invalidateQueries({ queryKey: chatKeys.curator() })
        queryClient.invalidateQueries({
          queryKey: [...chatKeys.all, "all-task-executions"],
        })
        queryClient.invalidateQueries({
          queryKey: [...chatKeys.all, "curator-executions"],
        })
        queryClient.invalidateQueries({
          queryKey: [...chatKeys.all, "orchestration-plans"],
        })
      }
    },
    onSuccess: (_data, variables) => {
      // 被删会话若有后台浏览器标记 → 回收，避免 id 永久滞留 backgroundSessions
      useBrowserStore.getState().clearBackground(String(variables.conversationId))
      resetChatRightPanels()
    },
  })
}

export function useResetCuratorConversation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      conversationId,
      contactId,
      clearTaskLogs,
    }: {
      conversationId: number | string
      contactId: string
      clearTaskLogs?: boolean
    }) => {
      const promises: Promise<unknown>[] = [
        deleteConversationApi(conversationId),
      ]
      if (clearTaskLogs) {
        promises.push(
          deleteTaskExecutionsByOrchestratorConversation(conversationId)
        )
      }
      await Promise.all(promises)
    },
    onSuccess: (_data, variables) => {
      useBrowserStore.getState().clearBackground(String(variables.conversationId))
      queryClient.invalidateQueries({ queryKey: chatKeys.curator() })
      queryClient.invalidateQueries({
        queryKey: chatKeys.conversations(variables.contactId),
      })
      queryClient.invalidateQueries({
        queryKey: [...chatKeys.all, "all-task-executions"],
      })
      queryClient.invalidateQueries({
        queryKey: [...chatKeys.all, "curator-executions"],
      })
      queryClient.invalidateQueries({
        queryKey: [...chatKeys.all, "orchestration-plans"],
      })
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

export function useConversationResourcesQuery(
  conversationId: string | number | null
) {
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
  path: string | null
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
