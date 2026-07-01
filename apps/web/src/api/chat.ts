import type { Employee } from "@/api/types"
import { CURATOR_AVATAR_URL } from "@/lib/avatar"
import { getServerBaseUrl } from "@/lib/request"
import { fetchEmployees } from "@/api/employee"
import {
  approveHitl as approveHitlApi,
  cancelConversationStream as cancelConversationStreamApi,
  createConversation as createConversationApi,
  deleteAllTaskExecutions as deleteAllTaskExecutionsApi,
  deleteTaskExecutionsByOrchestratorConversation,
  deleteConversation as deleteConversationApi,
  deleteConversationUpload as deleteConversationUploadApi,
  deleteResource as deleteResourceApi,
  downloadResource as downloadResourceApi,
  downloadResourceBlob as downloadResourceBlobApi,
  fetchConversationMessages as fetchConversationMessagesApi,
  fetchConversationResources as fetchConversationResourcesApi,
  deleteConversationsByTarget as deleteConversationsByTargetApi,
  fetchConversations as fetchConversationsApi,
  fetchCuratorConversation as fetchCuratorConversationApi,
  fetchResourceContent as fetchResourceContentApi,
  resetConversationStatus as resetConversationStatusApi,
  submitBugFeedback as submitBugFeedbackApi,
  suggestConversationTitle as suggestConversationTitleApi,
  updateConversationTitle as updateConversationTitleApi,
  uploadConversationFile as uploadConversationFileApi,
  uploadVoiceAudio as uploadVoiceAudioApi,
  fetchVoiceAudioBlob as fetchVoiceAudioBlobApi,
} from "@/api/conversation"
import {
  getExternalDirMode as getExternalDirModeApi,
  setExternalDirMode as setExternalDirModeApi,
} from "@/api/conversation"
import {
  mapChatMessageToMessage,
  mapConversationListItemToConversation,
  mapCreatedConversationListItem,
} from "@/lib/chat/chat-mappers"
import { mapContactToTarget } from "@/lib/chat/contact-target"
import type {
  AIEmployee,
  Contact,
  Conversation,
  CuratorProfile,
  Message,
} from "@/types/chat"

export type {
  HitlDecision,
  BugFeedbackInput,
  BugFeedbackResult,
  ExternalDirMode,
} from "@/api/conversation"

export {
  getExternalDirModeApi as getExternalDirMode,
  setExternalDirModeApi as setExternalDirMode,
}

export {
  approveHitlApi as approveHitl,
  submitBugFeedbackApi as submitBugFeedback,
  cancelConversationStreamApi as cancelConversationStream,
  deleteAllTaskExecutionsApi as deleteAllTaskExecutions,
  deleteTaskExecutionsByOrchestratorConversation,
  deleteConversationApi as deleteConversation,
  deleteConversationUploadApi as deleteConversationUpload,
  deleteResourceApi as deleteResource,
  downloadResourceApi as downloadResource,
  downloadResourceBlobApi as downloadResourceBlob,
  fetchConversationResourcesApi as fetchConversationResources,
  fetchCuratorConversationApi as fetchCuratorConversation,
  fetchResourceContentApi as fetchResourceContent,
  resetConversationStatusApi as resetConversationStatus,
  suggestConversationTitleApi as suggestConversationTitle,
  updateConversationTitleApi as updateConversationTitle,
  uploadConversationFileApi as uploadConversationFile,
  uploadVoiceAudioApi as uploadVoiceAudio,
  fetchVoiceAudioBlobApi as fetchVoiceAudioBlob,
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
    // 总管保留固定图片头像；普通员工不再用生成式头像（DiceBear），改为
    // 自定义上传头像(emp.avatar，后端相对路径→拼后端 base) → 无则留空，渲染时回落到两字头像。
    avatar: emp.is_curator
      ? CURATOR_AVATAR_URL
      : emp.avatar
        ? getServerBaseUrl() + emp.avatar
        : undefined,
    status: mapStatus(emp.metadata?.status ?? 0),
    specialty: emp.metadata?.capability_desc ?? "",
    skills: emp.metadata?.skills ?? [],
    skillCandidateCount: emp.skill_candidate_count ?? 0,
  }
}

export { mapContactToTarget }

export async function fetchContacts(signal?: AbortSignal): Promise<Contact[]> {
  // 群已退场（阶段4）：联系人仅总管 + 员工，不再拉群端点。
  const employeesRes = await fetchEmployees({ signal })

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

  return [...curatorContacts, ...employeeContacts]
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

/** 删除某联系人下的全部会话（含消息、checkpoint 与产物，走后端批量 DELETE） */
export async function deleteAllConversationsForContact(
  _contactId: string,
  contact: Contact,
  opts?: { signal?: AbortSignal }
): Promise<string[]> {
  const target = mapContactToTarget(contact)
  if (!target) {
    throw new Error("无法确定聊天目标类型")
  }
  if (target.target_type === "curator") {
    throw new Error("不允许删除总管会话")
  }

  const res = await deleteConversationsByTargetApi(
    {
      target_type: target.target_type,
      target_id: target.target_id,
    },
    opts
  )
  const deletedIds = res?.data?.deleted_ids ?? []
  return deletedIds.map(String)
}
