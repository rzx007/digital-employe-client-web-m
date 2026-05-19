import { cn } from "@workspace/ui/lib/utils"
import { DiffViewer } from "@workspace/ui/components/diff-viewer"
import { useLayoutEffect, useMemo, useRef, useState } from "react"
import { CodeHighlight, detectLanguage } from "../shared/code-highlight"
import { getDisplayContent, getEditDiff } from "./tool-shared"

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

  const scrollRef = useRef<HTMLDivElement>(null)
  const [isOverflowing, setIsOverflowing] = useState(false)

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    setIsOverflowing(el.scrollHeight > el.clientHeight)
  }, [displayContent, resultText])

  useLayoutEffect(() => {
    if ((isRunning || isPreliminaryOutput) && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [displayContent, isRunning, isPreliminaryOutput, resultText])

  if (!hasContent) return null

  return (
    <div className="space-y-2 px-1 pb-1 pt-0.5">
      {isPreliminaryOutput && resultText && (
        <div
          ref={scrollRef}
          className={cn(
            "max-h-52 overflow-y-auto rounded-md bg-background/60 px-2.5 py-2 text-xs leading-relaxed",
            "font-mono whitespace-pre-wrap text-muted-foreground/70"
          )}
        >
          {resultText}
          <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-muted-foreground/50 align-text-bottom" />
        </div>
      )}
      {!isPreliminaryOutput && editDiff && (
        <DiffViewer
          oldCode={editDiff.oldCode}
          newCode={editDiff.newCode}
          layout="unified"
          oldTitle="原始"
          newTitle="修改后"
          className="max-h-52 overflow-y-auto rounded-md"
        />
      )}
      {!isPreliminaryOutput && !editDiff && displayContent && (
        <div className="relative max-h-52 overflow-y-auto rounded-md bg-background/60">
          <CodeHighlight code={displayContent} language={detectedLang} />
          {state === "input-streaming" && (
            <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-muted-foreground/50 align-text-bottom" />
          )}
          {isOverflowing && !isRunning && !isOpen && (
            <div className="pointer-events-none absolute right-0 bottom-0 left-0 h-6 bg-gradient-to-t from-background/60 to-transparent" />
          )}
        </div>
      )}
      {!isPreliminaryOutput && hasResult && (
        <div
          ref={scrollRef}
          className={cn(
            "max-h-52 overflow-y-auto rounded-md bg-background/60 px-2.5 py-2 text-xs leading-relaxed",
            isError
              ? "text-destructive/70"
              : "font-mono whitespace-pre-wrap text-muted-foreground/70"
          )}
        >
          {resultText}
        </div>
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
