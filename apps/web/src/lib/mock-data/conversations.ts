import type { Message } from "./messages"

export type ConversationStatus = "error" | "idle" | "running" | "unread"

export interface Conversation {
  id: string
  title: string
  contactId: string // 对应 CONTACTS 中的 id
  status?: ConversationStatus
  lastMessage?: string
  lastMessageTime?: Date
  lastMessageType?: "text" | "image" | "file"
  unreadCount: number
  updatedAt: Date
  messages?: Message[]
}

export const CONVERSATIONS: Conversation[] = [
  {
    id: "conv-1",
    title: "请假流程咨询",
    contactId: "hr-manager", // 陈小红
    status: "unread",
    lastMessage: "好的，我会帮你处理这个问题。",
    lastMessageTime: new Date(Date.now() - 30 * 60 * 1000), // 30分钟前
    lastMessageType: "text",
    unreadCount: 2,
    updatedAt: new Date(Date.now() - 30 * 60 * 1000),
  },
  {
    id: "conv-2",
    title: "重构方案评审",
    contactId: "group-tech", // 技术讨论群
    status: "running",
    lastMessage: "王大明: 我们需要重新评估这个方案",
    lastMessageTime: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2小时前
    lastMessageType: "text",
    unreadCount: 0,
    updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
  },
  {
    id: "conv-3",
    title: "首页改版评审",
    contactId: "product-designer", // 李晓琳
    status: "idle",
    lastMessage: "设计稿已经发给你了，请查收",
    lastMessageTime: new Date(Date.now() - 24 * 60 * 60 * 1000), // 1天前
    lastMessageType: "text",
    unreadCount: 1,
    updatedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
  },
  {
    id: "conv-4",
    title: "Q2 产品路线讨论",
    contactId: "group-product", // 产品讨论群
    status: "error",
    lastMessage: "陈小红: 新的产品方案已经通过了",
    lastMessageTime: new Date(Date.now() - 3 * 60 * 60 * 1000), // 3小时前
    lastMessageType: "text",
    unreadCount: 0,
    updatedAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
  },
  {
    id: "conv-5",
    title: "AISO 产品路线讨论",
    contactId: "group-product", // 产品讨论群
    status: "running",
    lastMessage: "陈小红: 你看看你干的是什么",
    lastMessageTime: new Date(Date.now() - 10 * 60 * 1000),
    lastMessageType: "text",
    unreadCount: 0,
    updatedAt: new Date(Date.now() - 10 * 60 * 1000),
  },
]

export const getConversationsByContactId = (
  contactId: string
): Conversation[] => {
  return CONVERSATIONS.filter((conv) => conv.contactId === contactId)
}

export const getConversationById = (id: string): Conversation | undefined => {
  return CONVERSATIONS.find((conv) => conv.id === id)
}
