import type { VoiceMessageMeta } from "@/types/chat"

/** 从消息 metadata 中提取合法的语音元数据；不合法返回 null。 */
export function getVoiceMeta(
  metadata: Record<string, unknown> | undefined
): VoiceMessageMeta | null {
  const v = metadata?.voice
  if (!v || typeof v !== "object") return null
  const meta = v as Record<string, unknown>
  if (typeof meta.duration_ms !== "number") return null
  if (typeof meta.audio_path !== "string" || !meta.audio_path) return null
  return {
    duration_ms: meta.duration_ms,
    audio_path: meta.audio_path,
    waveform: Array.isArray(meta.waveform)
      ? meta.waveform.filter((n): n is number => typeof n === "number")
      : [],
  }
}
