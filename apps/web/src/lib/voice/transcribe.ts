/**
 * 语音转写：经后端代理到配置的 ASR 服务（OpenAI 兼容 / Finch 等）。
 * 聊天语音消息与宠物语音共用。
 */

import { getRequestErrorMessage, request } from "@/lib/request"
import type { ApiResponse } from "@/api/types"

export async function transcribeAudio(blob: Blob): Promise<string> {
  const form = new FormData()
  form.append("file", blob, "recording.webm")

  try {
    const res = await request<ApiResponse<{ text: string }>>(
      "/model/transcribe",
      {
        method: "POST",
        body: form,
      }
    )

    const text = res.data?.text?.trim()
    if (!text) {
      throw new Error(res.msg || "转写返回为空")
    }
    return text
  } catch (err) {
    throw new Error(getRequestErrorMessage(err, "语音转写失败"))
  }
}
