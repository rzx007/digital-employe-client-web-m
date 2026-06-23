import { createConversation } from "@/api/chat"
import { getContactId } from "@/lib/chat/contact-utils"
import type { Contact, Conversation } from "@/types/chat"

/**
 * 为某个员工 contact 确保有一条会话（无则创建），返回该会话。
 *
 * 关键：用**模块级** in-flight 去重（按 contactId），而非组件 useRef——
 * 工作台成员面板在父组件频繁重渲染/重挂载下，组件级 ref 会被重置导致重复或丢失创建。
 * 模块级 guard 跨重挂载存活，保证「同一员工并发/连续调用合并为一次创建」。
 *
 * 与 ensureCuratorConversationAndSelect 同构（总管有 GET-ensure 端点，员工只能显式建）。
 */
const inFlight = new Map<string, Promise<Conversation>>()

export async function ensureEmployeeConversation(
  contact: Contact,
  title = "工作台对话"
): Promise<Conversation> {
  if (contact.type !== "employee" || !contact.employee?.id) {
    throw new Error("不是员工联系人")
  }
  const contactId = getContactId(contact)
  if (!contactId) {
    throw new Error("无法解析员工 contactId")
  }

  const existing = inFlight.get(contactId)
  if (existing) return existing

  const promise = (async () => {
    try {
      return await createConversation({ contactId, title, contact })
    } finally {
      if (inFlight.get(contactId) === promise) {
        inFlight.delete(contactId)
      }
    }
  })()

  inFlight.set(contactId, promise)
  return promise
}
