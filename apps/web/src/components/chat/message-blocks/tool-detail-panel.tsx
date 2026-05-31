import { DiffViewer } from "@workspace/ui/components/diff-viewer"
import { IconLoader } from "@tabler/icons-react"
import { useEffect, useRef } from "react"
import { CodeHighlight, detectLanguage } from "../shared/code-highlight"
import { useArtifactStore } from "@/stores/artifact-store"
import {
  AUTO_OPEN_ARTIFACT_ON_STREAM,
  formatCompactCharCount,
  getContentLength,
  getDisplayContent,
  getEditDiff,
  getFilePathFromToolInput,
  isArtifactLikePath,
  isFileWriteLightweightPhase,
  LARGE_FILE_PREVIEW_CHARS,
  normalizeToolFilePath,
} from "./tool-shared"
import { ToolOutputViewport } from "./tool-output-viewport"

export type ToolDetailPanelProps = {
  toolCallId: string | null
  toolName: string
  state: string
  input?: unknown
  resultText?: string | null
  preliminary?: boolean
  isRunning: boolean
  isOpen: boolean
}

function FileWriteStreamingProgress({
  toolName,
  state,
  input,
}: {
  toolName: string
  state: string
  input?: unknown
}) {
  const filePath = getFilePathFromToolInput(input, toolName)
  const basename = filePath?.split(/[/\\]/).pop()
  const contentLength = getContentLength(input, toolName)
  const phaseLabel =
    state === "input-streaming"
      ? contentLength > 0
        ? `已接收 ${formatCompactCharCount(contentLength)}`
        : "正在接收内容"
      : "正在写入磁盘"

  return (
    <div className="flex items-center gap-1.5 px-1 py-1 text-xs text-muted-foreground">
      <IconLoader className="size-3 shrink-0 animate-spin" />
      <span className="min-w-0 truncate">
        {basename ? (
          <>
            <span className="font-mono text-foreground/70">{basename}</span>
            <span className="text-muted-foreground/80"> · {phaseLabel}</span>
          </>
        ) : (
          phaseLabel
        )}
      </span>
    </div>
  )
}

export function ToolDetailPanel({
  toolCallId,
  toolName,
  state,
  input,
  resultText,
  preliminary,
  isRunning,
  isOpen,
}: ToolDetailPanelProps) {
  const isError = state === "output-error"
  const isPreliminaryOutput =
    state === "output-available" && preliminary === true

  const displayContent = getDisplayContent(input, toolName)
  const contentLength = displayContent?.length ?? 0
  const filePath = getFilePathFromToolInput(input, toolName)
  const normalizedFilePath = filePath ? normalizeToolFilePath(filePath) : null
  const editDiff = toolName === "edit_file" ? getEditDiff(input) : null
  const detectedLang = detectLanguage(
    (input as Record<string, unknown> | null)?.file_path as string
  )
  const hasResult = !!resultText
  const isInputStreaming = state === "input-streaming"
  const useLightweightFileWrite = isFileWriteLightweightPhase(
    toolName,
    state,
    isRunning,
    contentLength
  )
  const hasContent =
    useLightweightFileWrite ||
    !!displayContent ||
    hasResult ||
    (toolName === "edit_file" && !!editDiff)

  const shouldTruncatePreview =
    (toolName === "write_file" || toolName === "edit_file") &&
    contentLength > LARGE_FILE_PREVIEW_CHARS
  const previewContent = shouldTruncatePreview
    ? displayContent?.slice(0, LARGE_FILE_PREVIEW_CHARS) ?? null
    : displayContent

  const openResource = useArtifactStore((s) => s.openResource)
  const didAutoOpenRef = useRef<string | null>(null)
  const isStdoutStreaming = isRunning || isPreliminaryOutput

  useEffect(() => {
    if (!AUTO_OPEN_ARTIFACT_ON_STREAM) return
    if (!shouldTruncatePreview) return
    if (!normalizedFilePath) return
    if (!toolCallId) return
    if (!isArtifactLikePath(normalizedFilePath)) return
    if (!(isInputStreaming || isRunning)) return
    const { activeResourcePath, isPanelOpen } = useArtifactStore.getState()
    if (activeResourcePath === normalizedFilePath && isPanelOpen) return
    if (didAutoOpenRef.current === toolCallId) return
    didAutoOpenRef.current = toolCallId
    queueMicrotask(() => {
      const { activeResourcePath: currentPath, isPanelOpen: currentOpen } =
        useArtifactStore.getState()
      if (currentPath === normalizedFilePath && currentOpen) return
      openResource(normalizedFilePath)
    })
  }, [
    isInputStreaming,
    isRunning,
    normalizedFilePath,
    openResource,
    shouldTruncatePreview,
    toolCallId,
  ])

  if (!hasContent) return null

  if (useLightweightFileWrite && !editDiff) {
    return (
      <FileWriteStreamingProgress
        toolName={toolName}
        state={state}
        input={input}
      />
    )
  }

  return (
    <div className="space-y-2 px-1 pt-0.5 pb-1">
      {isPreliminaryOutput && resultText && (
        <ToolOutputViewport
          text={resultText}
          isStreaming={isStdoutStreaming}
          showCursor
        />
      )}
      {!isPreliminaryOutput && editDiff && (
        <DiffViewer
          oldCode={editDiff.oldCode}
          newCode={editDiff.newCode}
          layout="unified"
          oldTitle="原始"
          newTitle="修改后"
          className="max-h-52 overflow-y-auto"
        />
      )}
      {!isPreliminaryOutput && !editDiff && displayContent && (
        <div className="space-y-1">
          <ToolOutputViewport
            isStreaming={isInputStreaming}
            showCursor={isInputStreaming}
            showFogWhenCollapsed={!isOpen}
            contentClassName="p-0"
          >
            <div className="relative">
              <CodeHighlight
                code={previewContent ?? ""}
                language={detectedLang}
                streaming={isInputStreaming || isPreliminaryOutput || isRunning}
              />
              {shouldTruncatePreview && (
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-10 bg-gradient-to-t from-background/95 via-background/50 to-transparent"
                />
              )}
            </div>
          </ToolOutputViewport>
          {shouldTruncatePreview && (
            <div className="px-1 text-[11px] text-muted-foreground">
              仅预览部分内容，完整内容请看右侧文件面板
            </div>
          )}
        </div>
      )}
      {!isPreliminaryOutput && hasResult && (
        <ToolOutputViewport
          text={resultText}
          isStreaming={isStdoutStreaming}
          isError={isError}
        />
      )}
    </div>
  )
}

export function toolDetailHasContent(
  input: unknown,
  toolName: string,
  resultText?: string | null,
  state?: string,
  isRunning?: boolean
): boolean {
  const contentLength = getContentLength(input, toolName)
  if (
    state &&
    isRunning !== undefined &&
    isFileWriteLightweightPhase(toolName, state, isRunning, contentLength)
  ) {
    return true
  }
  return (
    !!getDisplayContent(input, toolName) ||
    !!resultText ||
    (toolName === "edit_file" && !!getEditDiff(input))
  )
}
