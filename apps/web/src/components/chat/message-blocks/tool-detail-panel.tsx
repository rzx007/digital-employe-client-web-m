import { DiffViewer } from "@workspace/ui/components/diff-viewer"
import { useMemo } from "react"
import { CodeHighlight, detectLanguage } from "../shared/code-highlight"
import { getDisplayContent, getEditDiff } from "./tool-shared"
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

  if (!hasContent) return null

  const isStdoutStreaming = isRunning || isPreliminaryOutput
  const isInputStreaming = state === "input-streaming"

  return (
    <div className="space-y-2 px-1 pb-1 pt-0.5">
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
          className="max-h-52 overflow-y-auto "
        />
      )}
      {!isPreliminaryOutput && !editDiff && displayContent && (
        <ToolOutputViewport
          isStreaming={isInputStreaming}
          showCursor={isInputStreaming}
          showFogWhenCollapsed={!isOpen}
          contentClassName="p-0"
        >
          <CodeHighlight code={displayContent} language={detectedLang} />
        </ToolOutputViewport>
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
