import { uploadVoiceAudio } from "@/api/conversation"
import type { VoiceMessageMeta } from "@/types/chat"

export interface VoiceDraft {
  durationMs: number
  waveform: number[]
  blob: Blob
}

/** 上传语音音频并组装 extra_meta.voice；上传失败抛错（调用方 toast 并终止发送）。 */
export async function prepareVoiceMeta(
  conversationId: number | string,
  voice: VoiceDraft
): Promise<VoiceMessageMeta> {
  const res = await uploadVoiceAudio(conversationId, voice.blob)
  const audioPath = res.data?.audio_path
  if (!audioPath) {
    throw new Error(res.msg || "语音上传失败")
  }
  return {
    duration_ms: voice.durationMs,
    audio_path: audioPath,
    waveform: voice.waveform,
  }
}
