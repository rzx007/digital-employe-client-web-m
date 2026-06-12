import * as React from "react"
import {
  IconCopy,
  IconFileText,
  IconPlayerPauseFilled,
  IconPlayerPlayFilled,
} from "@tabler/icons-react"
import { toast } from "sonner"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@workspace/ui/components/context-menu"
import { cn } from "@workspace/ui/lib/utils"
import {
  useVoicePlayback,
  voicePlaybackManager,
} from "@/lib/voice/playback-manager"
import type { VoiceMessageMeta } from "@/types/chat"

const FALLBACK_BARS = Array.from({ length: 24 }, (_, i) =>
  Math.round(40 + 35 * Math.sin(i / 2.2))
)

function formatDuration(ms: number): string {
  const total = Math.max(1, Math.round(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, "0")}`
}

/** 时长 → 胶囊宽度（px），微信风格设上下限 */
function capsuleWidth(ms: number): number {
  const seconds = Math.min(60, Math.max(1, ms / 1000))
  return Math.round(140 + (seconds / 60) * 140)
}

export function VoiceMessageCapsule({
  messageId,
  conversationId,
  meta,
  transcript,
}: {
  messageId: string
  conversationId: number | string
  meta: VoiceMessageMeta
  transcript: string
}) {
  const playback = useVoicePlayback()
  const [showTranscript, setShowTranscript] = React.useState(false)
  const playing = playback.playingMessageId === messageId
  const bars = meta.waveform.length > 0 ? meta.waveform : FALLBACK_BARS

  const handleToggle = React.useCallback(() => {
    voicePlaybackManager
      .toggle(messageId, conversationId, meta.audio_path)
      .catch(() => toast.error("语音文件不存在"))
  }, [messageId, conversationId, meta.audio_path])

  const handleCopy = React.useCallback(() => {
    navigator.clipboard
      .writeText(transcript)
      .then(() => toast.success("已复制"))
      .catch(() => toast.error("复制失败"))
  }, [transcript])

  return (
    <div className="flex flex-col items-end gap-1">
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <button
            type="button"
            onClick={handleToggle}
            style={{ width: capsuleWidth(meta.duration_ms) }}
            className={cn(
              "flex h-10 items-center gap-2 rounded-2xl px-3",
              "bg-primary text-primary-foreground transition-colors hover:bg-primary/90"
            )}
            aria-label={playing ? "暂停语音" : "播放语音"}
          >
            {playing ? (
              <IconPlayerPauseFilled className="size-4 shrink-0" />
            ) : (
              <IconPlayerPlayFilled className="size-4 shrink-0" />
            )}
            <span className="flex h-5 flex-1 items-center gap-px overflow-hidden">
              {bars.map((value, i) => {
                const played = playing && i / bars.length <= playback.progress
                return (
                  <span
                    key={i}
                    style={{ height: `${Math.max(15, value)}%` }}
                    className={cn(
                      "w-[3px] shrink-0 rounded-full",
                      played
                        ? "bg-primary-foreground"
                        : "bg-primary-foreground/45"
                    )}
                  />
                )
              })}
            </span>
            <span className="shrink-0 text-xs tabular-nums">
              {formatDuration(meta.duration_ms)}
            </span>
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={() => setShowTranscript((v) => !v)}>
            <IconFileText className="size-4" />
            {showTranscript ? "收起文本" : "查看文本"}
          </ContextMenuItem>
          <ContextMenuItem onSelect={handleCopy}>
            <IconCopy className="size-4" />
            复制文本
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {showTranscript && (
        <div className="max-w-xs rounded-lg bg-muted px-3 py-2 text-sm text-foreground">
          {transcript}
        </div>
      )}
    </div>
  )
}
