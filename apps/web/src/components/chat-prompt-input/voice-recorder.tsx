import * as React from "react"
import { IconX } from "@tabler/icons-react"
import { LiveWaveform } from "@workspace/ui/components/ai-elements/live-waveform"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { describeMicError } from "@/lib/voice/mic-error"
import type { RecorderPhase } from "./use-voice-recorder"

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, "0")}`
}

export function VoiceRecorderOverlay({
  phase,
  elapsedMs,
  onStreamReady,
  onSend,
  onCancel,
  onMicError,
}: {
  phase: RecorderPhase
  elapsedMs: number
  onStreamReady: (stream: MediaStream) => void
  onSend: () => void
  onCancel: () => void
  onMicError: (message: string) => void
}) {
  const [hovering, setHovering] = React.useState(false)
  const transcribing = phase === "transcribing"

  return (
    <div className="absolute inset-0 z-10 flex items-center gap-2 rounded-[inherit] bg-background/95 px-3 backdrop-blur-sm">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="shrink-0 rounded-full"
        onClick={onCancel}
        disabled={transcribing}
        aria-label="取消录音"
      >
        <IconX className="size-4" />
      </Button>
      <button
        type="button"
        className={cn(
          "relative flex h-10 flex-1 items-center justify-center overflow-hidden",
          "rounded-full bg-primary/90 px-4 transition-colors",
          hovering && !transcribing && "bg-primary"
        )}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        onClick={() => {
          if (!transcribing) onSend()
        }}
        disabled={transcribing}
        aria-label="发送语音"
      >
        <LiveWaveform
          active={phase === "recording"}
          processing={transcribing}
          mode="scrolling"
          height={28}
          barColor="rgba(255,255,255,0.9)"
          className={cn(
            "w-full transition-opacity",
            hovering && !transcribing && "opacity-20"
          )}
          onStreamReady={onStreamReady}
          onError={(err) => onMicError(describeMicError(err))}
        />
        {hovering && !transcribing && (
          <span className="absolute text-sm font-medium text-primary-foreground">
            发送
          </span>
        )}
        {transcribing && (
          <span className="absolute text-sm text-primary-foreground/90">
            转写中…
          </span>
        )}
      </button>
      <span className="w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
        {formatElapsed(elapsedMs)}
      </span>
    </div>
  )
}
