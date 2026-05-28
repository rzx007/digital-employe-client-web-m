import type { PendingResource } from "./types"
import {
  resolveRendererKindFromPath,
  resolveStreamingPreviewMode,
  type ArtifactRendererKind,
  type StreamingPreviewMode,
} from "./preview-streaming"

export type ArtifactPreviewPhase = "ready" | "streaming"

export interface PendingPreviewState {
  phase: ArtifactPreviewPhase
  rendererKind: ArtifactRendererKind
  streamingMode: StreamingPreviewMode
  /** 流式阶段使用占位（骨架屏等），不渲染真实预览 */
  showStreamingPlaceholder: boolean
  skipApiContentFetch: boolean
  /** 流式阶段用 pending 内容做 live 预览（如 code / markdown） */
  shouldUsePendingContent: boolean
}

/** @deprecated 使用 getPendingPreviewState */
export interface PendingPreviewFlags {
  isPendingDocStreaming: boolean
  skipApiContentFetch: boolean
  shouldUsePendingContent: boolean
}

export function getPendingPreviewState(
  selectedPending: PendingResource | null,
  filePath: string | null | undefined,
  hasResourceContent: boolean,
  artifactType?: string | null
): PendingPreviewState {
  const isStreaming = selectedPending?.isStreaming === true
  const rendererKind = resolveRendererKindFromPath(filePath, artifactType)
  const streamingMode = resolveStreamingPreviewMode(filePath, artifactType)
  const showStreamingPlaceholder = isStreaming && streamingMode === "placeholder"
  const skipApiContentFetch = !!selectedPending && isStreaming
  const shouldUsePendingContent =
    !!selectedPending &&
    streamingMode === "live" &&
    (isStreaming || !hasResourceContent)

  return {
    phase: isStreaming ? "streaming" : "ready",
    rendererKind,
    streamingMode,
    showStreamingPlaceholder,
    skipApiContentFetch,
    shouldUsePendingContent,
  }
}

/** @deprecated 使用 getPendingPreviewState */
export function getPendingPreviewFlags(
  selectedPending: PendingResource | null,
  isDocFile: boolean,
  hasResourceContent: boolean
): PendingPreviewFlags {
  const state = getPendingPreviewState(
    selectedPending,
    isDocFile ? "/placeholder.pdf" : null,
    hasResourceContent,
    isDocFile ? "document" : null
  )
  return {
    isPendingDocStreaming:
      isDocFile && selectedPending?.isStreaming === true,
    skipApiContentFetch: state.skipApiContentFetch,
    shouldUsePendingContent: state.shouldUsePendingContent,
  }
}
