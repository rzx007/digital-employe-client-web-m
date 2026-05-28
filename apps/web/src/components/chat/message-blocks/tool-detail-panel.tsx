import { DiffViewer } from "@workspace/ui/components/diff-viewer"
import { useEffect, useMemo, useRef } from "react"
import { CodeHighlight, detectLanguage } from "../shared/code-highlight"
import { useArtifactStore } from "@/stores/artifact-store"
import { useSyncPendingResourceFromTool } from "@/lib/chat/pending-resources"
import {
  getDisplayContent,
  getEditDiff,
  getFilePathFromToolInput,
  isArtifactLikePath,
  LARGE_FILE_PREVIEW_CHARS,
  normalizeToolFilePath,
} from "./tool-shared"
import { ToolOutputViewport } from "./tool-output-viewport"

export type ToolDetailPanelProps = {
  toolName: string
  state: string
  input?: unknown
  resultText?: string | null
  preliminary?: boolean
  isRunning: boolean
  isOpen: boolean
}

export function ToolDetailPanel({
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

  const displayContent = useMemo(
    () => getDisplayContent(input, toolName),
    [input, toolName]
  )
  const filePath = useMemo(
    () => getFilePathFromToolInput(input, toolName),
    [input, toolName]
  )
  const normalizedFilePath = useMemo(
    () => (filePath ? normalizeToolFilePath(filePath) : null),
    [filePath]
  )
  const editDiff = useMemo(
    () => (toolName === "edit_file" ? getEditDiff(input) : null),
    [toolName, input]
  )
  const detectedLang = useMemo(
    () =>
      detectLanguage(
        (input as Record<string, unknown> | null)?.file_path as string
      ),
    [input]
  )
  const hasResult = !!resultText
  const hasContent = !!displayContent || hasResult

  const shouldTruncatePreview =
    (toolName === "write_file" || toolName === "edit_file") &&
    (displayContent?.length ?? 0) > LARGE_FILE_PREVIEW_CHARS
  const previewContent = shouldTruncatePreview
    ? displayContent?.slice(0, LARGE_FILE_PREVIEW_CHARS) ?? null
    : displayContent

  const openResource = useArtifactStore((s) => s.openResource)
  const didAutoOpenRef = useRef<string | null>(null)
  const isStdoutStreaming = isRunning || isPreliminaryOutput
  const isInputStreaming = state === "input-streaming"

  useSyncPendingResourceFromTool({
    toolName,
    state,
    preliminary,
    isRunning,
    normalizedFilePath,
    displayContent,
  })

  useEffect(() => {
    if (!shouldTruncatePreview) return
    if (!normalizedFilePath) return
    if (!isArtifactLikePath(normalizedFilePath)) return
    if (!(isInputStreaming || isRunning)) return
    const { activeResourcePath, isPanelOpen } = useArtifactStore.getState()
    if (activeResourcePath === normalizedFilePath && isPanelOpen) return
    if (didAutoOpenRef.current === normalizedFilePath) return
    didAutoOpenRef.current = normalizedFilePath
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
  ])

  if (!hasContent) return null

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
              <CodeHighlight code={previewContent ?? ""} language={detectedLang} />
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
  resultText?: string | null
): boolean {
  return (
    !!getDisplayContent(input, toolName) ||
    !!resultText ||
    (toolName === "edit_file" && !!getEditDiff(input))
  )
}
