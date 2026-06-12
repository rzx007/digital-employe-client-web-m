/**
 * 语音转写：上传音频到 Finch（或兼容）转写接口。
 * 聊天语音消息与宠物语音共用。
 * 直连外网地址可能受 CORS 限制，失败时请在后端做代理或配置 Finch CORS。
 */

const DEFAULT_TRANSCRIPTION_URL =
  "http://192.168.2.125:8082/finch/v1/audio/transcriptions"

function extractTranscript(json: unknown): string {
  if (json == null) return ""
  if (typeof json === "string") return json.trim()

  if (typeof json !== "object") return ""

  const j = json as Record<string, unknown>

  if (typeof j.text === "string") return j.text.trim()
  if (typeof j.transcript === "string") return j.transcript.trim()

  const data = j.data
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>
    if (typeof d.text === "string") return d.text.trim()
    if (typeof d.transcript === "string") return d.transcript.trim()
  }

  const choices = j.choices
  if (Array.isArray(choices) && choices[0] && typeof choices[0] === "object") {
    const c0 = choices[0] as Record<string, unknown>
    const msg = c0.message
    if (msg && typeof msg === "object") {
      const m = msg as Record<string, unknown>
      if (typeof m.content === "string") return m.content.trim()
    }
  }

  return ""
}

export async function transcribeAudio(blob: Blob): Promise<string> {
  const raw = import.meta.env.VITE_FINCH_TRANSCRIPTION_URL as string | undefined
  const endpoint = (raw?.trim() || DEFAULT_TRANSCRIPTION_URL).trim()

  const form = new FormData()
  form.append("file", blob, "recording.webm")
  const language = (
    import.meta.env.VITE_FINCH_TRANSCRIPTION_LANGUAGE as string | undefined
  )?.trim()
  form.append("language", language || "zh")

  const headers: HeadersInit = {}
  const key = import.meta.env.VITE_FINCH_TRANSCRIPTION_KEY as string | undefined
  if (key?.trim()) {
    headers.Authorization = `Bearer ${key.trim()}`
  }

  const res = await fetch(endpoint, {
    method: "POST",
    body: form,
    headers,
  })

  if (!res.ok) {
    const t = await res.text()
    throw new Error(`转写失败 (${res.status}): ${t.slice(0, 240)}`)
  }

  const json: unknown = await res.json()
  const text = extractTranscript(json)
  if (!text) {
    throw new Error("转写返回格式无法解析")
  }
  return text
}
