export type MessageRole = "user" | "assistant"

export interface Message {
  id: string
  conversationId: string
  senderId: string
  senderName: string
  role: MessageRole
  content: string
  timestamp: Date
  type?: "text" | "image" | "file"
  metadata?: Record<string, any>
  chunkJson?: string
}

export const MOCK_MESSAGES: Record<string, Message[]> = {
  "conv-1": [
    {
      id: "msg-1",
      conversationId: "conv-1",
      senderId: "user",
      senderName: "我",
      role: "user",
      content: "你好，请问公司的年假政策是怎样的？",
      timestamp: new Date(Date.now() - 35 * 60 * 1000),
    },
    {
      id: "msg-2",
      conversationId: "conv-1",
      senderId: "hr-manager",
      senderName: "陈小红",
      role: "assistant",
      content:
        "# 年假政策\n\n根据公司规定，员工年假如下：\n\n- 入职1年以下：5天\n- 入职1-3年：10天\n- 入职3年以上：15天\n\n年假需提前一周申请。",
      timestamp: new Date(Date.now() - 30 * 60 * 1000),
    },
  ],
  "conv-2": [
    {
      id: "msg-3",
      conversationId: "conv-2",
      senderId: "chief-engineer",
      senderName: "王大明",
      role: "assistant",
      content: "大家好，关于新项目的架构设计，我建议使用微服务架构。",
      timestamp: new Date(Date.now() - 3 * 60 * 60 * 1000),
    },
    {
      id: "msg-4",
      conversationId: "conv-2",
      senderId: "marketing-director",
      senderName: "赵伟",
      role: "assistant",
      content: "从市场推广的角度看，我建议我们优先考虑移动端用户体验。",
      timestamp: new Date(Date.now() - 2.5 * 60 * 60 * 1000),
    },
    {
      id: "msg-5",
      conversationId: "conv-2",
      senderId: "chief-engineer",
      senderName: "王大明",
      role: "assistant",
      content: "我们需要重新评估这个方案。",
      timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000),
    },
  ],
  "conv-3": [
    {
      id: "msg-6",
      conversationId: "conv-3",
      senderId: "product-designer",
      senderName: "李晓琳",
      role: "assistant",
      content: "设计稿已经发给你了，请查收",
      timestamp: new Date(Date.now() - 24 * 60 * 60 * 1000),
    },
  ],
  "conv-4": [
    {
      id: "msg-7",
      conversationId: "conv-4",
      senderId: "hr-manager",
      senderName: "陈小红",
      role: "assistant",
      content: "新的产品方案已经通过了审核，可以开始实施",
      timestamp: new Date(Date.now() - 3 * 60 * 60 * 1000),
    },
    {
      id: "msg-8",
      conversationId: "conv-4",
      senderId: "product-designer",
      senderName: "李晓琳",
      role: "assistant",
      content: "太好了！我会立即开始准备产品原型图，预计明天可以完成。",
      timestamp: new Date(Date.now() - 2.8 * 60 * 60 * 1000),
    },
  ],
}

export const getMessagesByConversationId = (
  conversationId: string
): Message[] => {
  return MOCK_MESSAGES[conversationId] || []
}
