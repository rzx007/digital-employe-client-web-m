import * as React from "react"
import { IconArrowUp, IconX } from "@tabler/icons-react"
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

/**
 * 内联录音胶囊：渲染在输入框底部工具栏右侧（替换发送按钮位置），
 * 形如「✕ + 波形胶囊 + 发送箭头」，不覆盖整个输入框。
 */
export function VoiceRecorderPill({
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
  const transcribing = phase === "transcribing"

  return (
    <div className="flex items-center gap-1.5">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8 shrink-0 rounded-full"
        onClick={onCancel}
        disabled={transcribing}
        aria-label="取消录音"
      >
        <IconX className="size-4" />
      </Button>
      <div
        className={cn(
          "flex h-8 w-44 items-center gap-2 overflow-hidden",
          "rounded-full bg-muted px-3 text-primary"
        )}
      >
        {/* 小画布上默认参数看不出起伏：条高 = value×高×0.8，18px 画布配
            sensitivity 1 时几乎全被 4px 最小条高钳平，故提高灵敏度并用满高度 */}
        <LiveWaveform
          active={phase === "recording"}
          processing={transcribing}
          mode="scrolling"
          height={24}
          barWidth={3}
          barGap={2}
          barHeight={2}
          sensitivity={3}
          fadeEdges={false}
          className="min-w-0 flex-1"
          onStreamReady={onStreamReady}
          onError={(err) => onMicError(describeMicError(err))}
        />
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
          {transcribing ? "转写中…" : formatElapsed(elapsedMs)}
        </span>
      </div>
      <Button
        type="button"
        size="icon"
        className="size-8 shrink-0 rounded-full bg-primary/80 transition-colors hover:bg-primary"
        onClick={onSend}
        disabled={transcribing}
        aria-label="发送语音"
      >
        <IconArrowUp className="size-4" />
      </Button>
    </div>
  )
}
