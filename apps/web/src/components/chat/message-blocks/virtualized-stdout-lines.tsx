import { cn } from "@workspace/ui/lib/utils"
import { useVirtualizer } from "@tanstack/react-virtual"
import { useStickToBottomContext } from "use-stick-to-bottom"
import { useCallback, useEffect, useMemo, useRef, type ReactNode } from "react"

const URL_RE = /https?:\/\/[^\s]+/g

function trimTrailingPunct(url: string): string {
  return url.replace(/[.,;:!?)"'，。、；：！？）】」』"'。，、；：!\]]+$/, "")
}

function renderWithLinks(text: string): ReactNode {
  const parts: ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  const re = new RegExp(URL_RE.source, "g")
  while ((match = re.exec(text)) !== null) {
    const full = match[0]
    const url = trimTrailingPunct(full)
    const trailing = full.slice(url.length)
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }
    parts.push(
      <a
        key={match.index}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="break-all underline opacity-100 hover:opacity-70"
        onClick={(e) => e.stopPropagation()}
      >
        {url}
      </a>
    )
    if (trailing) parts.push(trailing)
    lastIndex = match.index + full.length
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }
  return parts.length === 0 ? text : <>{parts}</>
}

export const VIRTUALIZE_LINE_THRESHOLD = 80

const LINE_ESTIMATE_PX = 18

export type VirtualizedStdoutLinesProps = {
  text: string
  isError?: boolean
  showCursor?: boolean
  isStreaming?: boolean
}

function StdoutCursor() {
  return (
    <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-muted-foreground/50 align-text-bottom" />
  )
}

function PlainStdoutLines({
  text,
  isError,
  showCursor,
}: Omit<VirtualizedStdoutLinesProps, "isStreaming">) {
  return (
    <pre
      className={cn(
        "m-0 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap",
        isError ? "text-destructive/70" : "text-muted-foreground/70"
      )}
    >
      {renderWithLinks(text)}
      {showCursor ? <StdoutCursor /> : null}
    </pre>
  )
}

function VirtualizedStdoutList({
  text,
  isError,
  showCursor,
  isStreaming,
}: VirtualizedStdoutLinesProps) {
  const { scrollRef, isAtBottom, scrollToBottom } = useStickToBottomContext()
  const lines = useMemo(() => text.split("\n"), [text])
  const lineCount = lines.length

  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: lineCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => LINE_ESTIMATE_PX,
    overscan: 12,
  })

  const measureRef = useCallback(
    (el: HTMLElement | null) => {
      virtualizer.measureElement(el)
    },
    [virtualizer]
  )

  const prevLineCountRef = useRef(lineCount)
  useEffect(() => {
    if (
      isStreaming &&
      lineCount > prevLineCountRef.current &&
      (isAtBottom === undefined || isAtBottom)
    ) {
      void scrollToBottom()
    }
    prevLineCountRef.current = lineCount
  }, [isStreaming, lineCount, isAtBottom, scrollToBottom, virtualizer])

  const items = virtualizer.getVirtualItems()
  const lastIndex = lineCount - 1

  return (
    <div
      className="relative w-full"
      style={{ height: `${virtualizer.getTotalSize()}px` }}
    >
      {items.map((virtualItem) => {
        const line = lines[virtualItem.index] ?? ""
        const isLast = virtualItem.index === lastIndex

        return (
          <div
            key={virtualItem.key}
            ref={measureRef}
            data-index={virtualItem.index}
            className={cn(
              "absolute top-0 left-0 w-full font-mono text-xs leading-relaxed break-all whitespace-pre-wrap",
              isError ? "text-destructive/70" : "text-muted-foreground/70"
            )}
            style={{ transform: `translateY(${virtualItem.start}px)` }}
          >
            {renderWithLinks(line)}
            {isLast && showCursor ? <StdoutCursor /> : null}
          </div>
        )
      })}
    </div>
  )
}

export function VirtualizedStdoutLines({
  text,
  isError,
  showCursor,
  isStreaming,
}: VirtualizedStdoutLinesProps) {
  const lineCount = useMemo(() => text.split("\n").length, [text])

  if (lineCount < VIRTUALIZE_LINE_THRESHOLD) {
    return (
      <PlainStdoutLines text={text} isError={isError} showCursor={showCursor} />
    )
  }

  return (
    <VirtualizedStdoutList
      text={text}
      isError={isError}
      showCursor={showCursor}
      isStreaming={isStreaming}
    />
  )
}
