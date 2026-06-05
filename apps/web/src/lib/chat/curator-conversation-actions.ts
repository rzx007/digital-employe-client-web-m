import type { QueryClient } from "@tanstack/react-query"

import { createConversation, fetchCuratorConversation } from "@/api/chat"
import { mapConversationListItemToConversation } from "@/lib/chat/chat-mappers"
import { selectConversationById } from "@/lib/chat/conversation-selection"
import { getContactId } from "@/lib/chat/contact-utils"
import { shouldRenameConversationOnFirstMessage } from "@/lib/chat/conversation-title"
import { selectWorkbenchCuratorConversation } from "@/lib/chat/conversation-selection/apply"
import { chatKeys } from "@/lib/query-keys/chat"
import type { Contact, Conversation, Message } from "@/types/chat"

export const CURATOR_DEFAULT_CONVERSATION_TITLE = "新对话"

/** 首条用户消息后是否应把占位标题改成语义标题 */
export function shouldRenameCuratorConversationOnFirstMessage(
  title: string | undefined
): boolean {
  return shouldRenameConversationOnFirstMessage(title)
}

export function primeCuratorConversationInCache(
  queryClient: QueryClient,
  conversation: Conversation
) {
  queryClient.setQueryData<Conversation[]>(
    chatKeys.conversations(conversation.contactId),
    (current) => {
      if (!current) return [conversation]
      const filtered = current.filter((item) => item.id !== conversation.id)
      return [conversation, ...filtered]
    }
  )
  queryClient.setQueryData<Message[]>(
    chatKeys.messages(conversation.id),
    []
  )
}

let ensureInFlight: Promise<Conversation> | null = null
let ensureInFlightContactId: string | null = null

type CuratorEnsureSnapshot = {
  isEnsuring: boolean
  error: string | null
}

let ensureSnapshot: CuratorEnsureSnapshot = { isEnsuring: false, error: null }
const ensureListeners = new Set<() => void>()

function emitCuratorEnsureChange() {
  ensureListeners.forEach((listener) => listener())
}

function patchCuratorEnsureSnapshot(patch: Partial<CuratorEnsureSnapshot>) {
  ensureSnapshot = { ...ensureSnapshot, ...patch }
  emitCuratorEnsureChange()
}

export function getCuratorEnsureSnapshot(): CuratorEnsureSnapshot {
  return ensureSnapshot
}

export function subscribeCuratorEnsure(listener: () => void) {
  ensureListeners.add(listener)
  return () => ensureListeners.delete(listener)
}

export function isEnsuringCuratorConversation(): boolean {
  return ensureSnapshot.isEnsuring
}

export type CuratorConversationSelectScope = "global" | "workbench"

function applyCuratorConversationSelection(
  conversationId: string | number,
  scope: CuratorConversationSelectScope = "global"
) {
  if (scope === "workbench") {
    selectWorkbenchCuratorConversation(conversationId)
    return
  }
  selectConversationById(conversationId)
}

/**
 * 总管无可用会话时：GET ensure → 写 cache → 选中。
 * 删光最后一条、bootstrap 兜底共用此入口；并发调用会合并为同一 Promise。
 */
export async function ensureCuratorConversationAndSelect(
  queryClient: QueryClient,
  contact: Contact,
  options?: { selectScope?: CuratorConversationSelectScope }
): Promise<Conversation> {
  if (contact.type !== "curator" || !contact.curator?.id) {
    throw new Error("不是总管联系人")
  }

  // 用带 type 前缀的 contactId（curator:5），与 selectedContactId / 会话缓存 key 一致，
  // 否则总管会话被缓存在裸 id "5" 下、chat-view 用 "curator:5" 读 → 列表同步异常。
  const contactId = getContactId(contact) ?? contact.curator.id

  if (ensureInFlight && ensureInFlightContactId === contactId) {
    return ensureInFlight
  }

  patchCuratorEnsureSnapshot({ isEnsuring: true, error: null })

  const promise = (async () => {
    try {
      const res = await fetchCuratorConversation()
      const item = res?.data
      if (item?.id == null) {
        throw new Error("获取总管会话失败")
      }

      const conversation = mapConversationListItemToConversation(item, contactId)
      primeCuratorConversationInCache(queryClient, conversation)
      applyCuratorConversationSelection(
        conversation.id,
        options?.selectScope ?? "global"
      )
      void queryClient.invalidateQueries({ queryKey: chatKeys.curator() })

      patchCuratorEnsureSnapshot({ isEnsuring: false, error: null })
      return conversation
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "请稍后重试"
      patchCuratorEnsureSnapshot({ isEnsuring: false, error: message })
      throw error
    }
  })()

  ensureInFlightContactId = contactId
  ensureInFlight = promise

  try {
    return await promise
  } finally {
    if (ensureInFlight === promise) {
      ensureInFlight = null
      ensureInFlightContactId = null
    }
  }
}

type CreateConversationMutate = (params: {
  contactId: string
  title?: string
  contact?: Contact
}) => Promise<Conversation>

export async function createAndSelectCuratorConversation(options: {
  contact: Contact
  title?: string
  mutateAsync?: CreateConversationMutate
  selectScope?: CuratorConversationSelectScope
}): Promise<Conversation> {
  const {
    contact,
    title = CURATOR_DEFAULT_CONVERSATION_TITLE,
    mutateAsync,
    selectScope = "global",
  } = options

  if (contact.type !== "curator" || !contact.curator?.id) {
    throw new Error("不是总管联系人")
  }

  const create =
    mutateAsync ??
    ((params) =>
      createConversation({
        contactId: params.contactId,
        title: params.title,
        contact: params.contact,
      }))

  const conversation = await create({
    contactId: getContactId(contact) ?? contact.curator.id,
    title,
    contact,
  })

  applyCuratorConversationSelection(conversation.id, selectScope)
  return conversation
}
