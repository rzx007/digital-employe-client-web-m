import type { ChatTargetType, Employee, Group as ApiGroup } from "@/api/types"
import { createDiceBearAvatar, CURATOR_AVATAR_URL } from "@/lib/avatar"
import { fetchEmployees } from "@/api/employee"
import { createGroup as createGroupApi, fetchGroups } from "@/api/group"
import {
  approveHitl as approveHitlApi,
  cancelConversationStream as cancelConversationStreamApi,
  createConversation as createConversationApi,
  deleteAllTaskExecutions as deleteAllTaskExecutionsApi,
  deleteConversation as deleteConversationApi,
  deleteConversationUpload as deleteConversationUploadApi,
  deleteResource as deleteResourceApi,
  downloadResource as downloadResourceApi,
  downloadResourceBlob as downloadResourceBlobApi,
  fetchConversationMessages as fetchConversationMessagesApi,
  fetchConversationResources as fetchConversationResourcesApi,
  fetchConversations as fetchConversationsApi,
  fetchCuratorConversation as fetchCuratorConversationApi,
  fetchResourceContent as fetchResourceContentApi,
  resetConversationStatus as resetConversationStatusApi,
  uploadConversationFile as uploadConversationFileApi,
} from "@/api/conversation"
import {
  mapChatMessageToMessage,
  mapConversationListItemToConversation,
  mapCreatedConversationListItem,
} from "@/lib/chat/chat-mappers"
import type {
  AIEmployee,
  Contact,
  Conversation,
  CuratorProfile,
  Message,
} from "@/types/chat"

export type { HitlDecision } from "@/api/conversation"

export {
  approveHitlApi as approveHitl,
  cancelConversationStreamApi as cancelConversationStream,
  deleteAllTaskExecutionsApi as deleteAllTaskExecutions,
  deleteConversationApi as deleteConversation,
  deleteConversationUploadApi as deleteConversationUpload,
  deleteResourceApi as deleteResource,
  downloadResourceApi as downloadResource,
  downloadResourceBlobApi as downloadResourceBlob,
  fetchConversationResourcesApi as fetchConversationResources,
  fetchCuratorConversationApi as fetchCuratorConversation,
  fetchResourceContentApi as fetchResourceContent,
  resetConversationStatusApi as resetConversationStatus,
  uploadConversationFileApi as uploadConversationFile,
}

function mapStatus(status: number): AIEmployee["status"] {
  if (status === 1) return "online"
  return "offline"
}

function mapEmployeeToAIEmployee(emp: Employee): AIEmployee {
  return {
    id: String(emp.id),
    name: emp.name ?? emp.metadata?.employee_name,
    role: emp.description || "",
    avatar: createDiceBearAvatar(String(emp.id)),
    status: mapStatus(emp.metadata?.status ?? 0),
    specialty: emp.metadata?.capability_desc ?? "",
    skills: emp.metadata?.skills ?? [],
  }
}

function mapContactToTarget(contact: Contact): {
  target_type: ChatTargetType
  target_id: number
} | null {
  if (contact.type === "curator") {
    const curatorId = Number(contact.curator?.id)
    return isNaN(curatorId)
      ? null
      : { target_type: "curator", target_id: curatorId }
  }
  if (contact.type === "employee") {
    const eid = Number(contact.employee?.id)
    return isNaN(eid) ? null : { target_type: "employee", target_id: eid }
  }
  if (contact.type === "group") {
    const gid = Number(contact.group?.id)
    return isNaN(gid) ? null : { target_type: "group", target_id: gid }
  }
  return null
}

export async function fetchContacts(signal?: AbortSignal): Promise<Contact[]> {
  const [employeesRes, groupsRes] = await Promise.all([
    fetchEmployees({ signal }),
    fetchGroups({ signal }),
  ])

  const allEmployees = (employeesRes?.data ?? []) as Employee[]

  const curatorEmployees = allEmployees.filter((e) => e.is_curator)
  const regularEmployees = allEmployees.filter((e) => !e.is_curator)

  const curatorContacts: Contact[] = curatorEmployees.map((emp) => {
    const profile: CuratorProfile = {
      id: String(emp.id),
      name: emp.name ?? emp.metadata?.employee_name ?? "",
      role: emp.description || "",
      avatar: CURATOR_AVATAR_URL,
      status: emp.metadata?.status === 1 ? "online" : "offline",
      specialty: emp.metadata?.capability_desc ?? "",
    }
    return { type: "curator" as const, curator: profile }
  })

  const employeeContacts: Contact[] = regularEmployees.map((emp) => ({
    type: "employee" as const,
    employee: mapEmployeeToAIEmployee(emp),
  }))

  const allAIEmployees: AIEmployee[] = allEmployees.map(mapEmployeeToAIEmployee)

  const groups: Contact[] = (groupsRes?.data ?? []).map((group: ApiGroup) => ({
    type: "group" as const,
    group: {
      id: String(group.id),
      name: group.name,
      participants: (group.employee_ids ?? [])
        .map((eid) => allAIEmployees.find((e) => e.id === String(eid)))
        .filter(Boolean) as AIEmployee[],
    },
  }))

  return [...curatorContacts, ...employeeContacts, ...groups]
}

export async function createContactGroup(params: {
  name: string
  employeeIds: number[]
}): Promise<ApiGroup> {
  const res = await createGroupApi({
    name: params.name,
    employee_ids: params.employeeIds,
  })
  return res.data ?? ({} as ApiGroup)
}

export async function fetchConversationsByContactId(
  contactId: string,
  contact?: Contact,
  opts?: { signal?: AbortSignal }
): Promise<Conversation[]> {
  if (!contact) return []

  const target = mapContactToTarget(contact)
  if (!target) return []

  const res = await fetchConversationsApi(
    {
      target_type: target.target_type,
      target_id: target.target_id,
    },
    opts
  )

  const items = res?.data ?? []

  return items.map((item) =>
    mapConversationListItemToConversation(item, contactId)
  )
}

export async function fetchMessagesByConversationId(
  conversationId: string | number,
  opts?: { signal?: AbortSignal }
): Promise<Message[]> {
  const res = await fetchConversationMessagesApi(conversationId, opts)
  const items = res?.data ?? []

  return items.map((msg) => mapChatMessageToMessage(msg, conversationId))
}

export async function createConversation(params: {
  contactId: string
  title?: string
  contact?: Contact
}): Promise<Conversation> {
  if (!params.contact) {
    return {
      id: `draft-${params.contactId}-${Date.now()}`,
      title: params.title ?? "新对话",
      contactId: params.contactId,
      updatedAt: new Date(),
      unreadCount: 0,
    }
  }

  const target = mapContactToTarget(params.contact)
  if (!target) {
    throw new Error("无法确定聊天目标类型")
  }

  const res = await createConversationApi({
    target_type: target.target_type,
    target_id: target.target_id,
    title: params.title ?? "新对话",
  })

  const item = res?.data
  if (!item) {
    throw new Error("创建会话失败")
  }

  return mapCreatedConversationListItem(item, params.contactId)
}
