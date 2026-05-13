import { fetchCuratorConversation } from "@/api/conversation"
import { request, getRequestHeaders } from "@/lib/request"

async function drainResponseBody(
  body: ReadableStream<Uint8Array> | null
): Promise<void> {
  if (!body) return
  const reader = body.getReader()
  try {
    for (;;) {
      const { done } = await reader.read()
      if (done) break
    }
  } finally {
    reader.releaseLock()
  }
}

/**
 * 将用户文本发到总管助手会话流（与 LangChainChatTransport 同一契约），
 * 并读完 SSE 体以便服务端正常收尾。
 */
export async function sendCuratorStreamMessage(
  question: string
): Promise<{ conversationId: string }> {
  const res = await fetchCuratorConversation()
  const conv = res?.data
  if (!conv?.id) {
    throw new Error("总管会话未就绪，请稍后再试")
  }

  const conversationId = String(conv.id)
  const response = await request.raw(
    `/chat/conversations/${conversationId}/stream`,
    {
      method: "POST",
      headers: getRequestHeaders({
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({
        question,
        skill: "",
        extra_meta: { source: "pet-voice" },
      }),
    }
  )

  if (!response.ok) {
    throw new Error(`聊天请求失败 (${response.status})`)
  }

  await drainResponseBody(response.body)
  return { conversationId }
}
