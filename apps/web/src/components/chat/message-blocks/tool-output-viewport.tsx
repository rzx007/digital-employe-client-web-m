import { cn } from "@workspace/ui/lib/utils"
import type { ReactElement } from "react"
import { useEffect, useState } from "react"
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom"
import { VirtualizedStdoutLines } from "./virtualized-stdout-lines"

type ToolOutputViewportBaseProps = {
  isStreaming?: boolean
  isError?: boolean
  showCursor?: boolean
  showFogWhenCollapsed?: boolean
  contentClassName?: string
  className?: string
}

export type ToolOutputViewportStdoutProps = ToolOutputViewportBaseProps & {
  text: string
  children?: never
}

export type ToolOutputViewportChildrenProps = ToolOutputViewportBaseProps & {
  text?: never
  /** ReactElement 与 StickToBottom 兼容，且避免 React 18/19 ReactNode（bigint）冲突 */
  children: ReactElement
}

export type ToolOutputViewportProps =
  | ToolOutputViewportStdoutProps
  | ToolOutputViewportChildrenProps

const STDOUT_CONTENT_CLASS =
  "px-2.5 py-2 font-mono text-xs leading-relaxed text-muted-foreground/70"

/** 实际滚动容器（scrollRef）：限高 + 可滚，粘底/虚拟化依赖此节点 */
const SCROLL_CONTAINER_CLASS = "max-h-52 overflow-y-auto overscroll-y-contain"

function ToolOutputCursor() {
  return (
    <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-muted-foreground/50 align-text-bottom" />
  )
}

function ToolOutputBottomFog() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-10 bg-gradient-to-t from-background/95 via-background/50 to-transparent"
    />
  )
}

function ToolOutputOverflowObserver({
  onOverflowChange,
}: {
  onOverflowChange: (overflowing: boolean) => void
}) {
  const { scrollRef } = useStickToBottomContext()

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    const check = () => {
      onOverflowChange(el.scrollHeight > el.clientHeight)
    }

    check()
    const observer = new ResizeObserver(check)
    observer.observe(el)
    el.addEventListener("scroll", check)

    return () => {
      observer.disconnect()
      el.removeEventListener("scroll", check)
    }
  }, [onOverflowChange, scrollRef])

  return null
}

function ToolOutputViewportBody(props: ToolOutputViewportProps) {
  const {
    isStreaming = false,
    isError = false,
    showCursor = false,
    showFogWhenCollapsed = false,
    contentClassName,
  } = props

  const [isOverflowing, setIsOverflowing] = useState(false)
  const showBottomFog = Boolean(
    isOverflowing && (isStreaming || showFogWhenCollapsed)
  )

  const fog = showBottomFog ? <ToolOutputBottomFog /> : null

  if ("text" in props) {
    const { text } = props as ToolOutputViewportStdoutProps
    const stdoutContentClass = cn(
      STDOUT_CONTENT_CLASS,
      isError && "text-destructive/70",
      contentClassName
    )

    return (
      <>
        <ToolOutputOverflowObserver onOverflowChange={setIsOverflowing} />
        <StickToBottom.Content
          scrollClassName={SCROLL_CONTAINER_CLASS}
          className={stdoutContentClass}
        >
          <VirtualizedStdoutLines
            text={text}
            isError={isError}
            showCursor={showCursor}
            isStreaming={isStreaming}
          />
        </StickToBottom.Content>
        {fog}
      </>
    )
  }

  const { children: richChildren } = props as ToolOutputViewportChildrenProps

  return (
    <>
      <ToolOutputOverflowObserver onOverflowChange={setIsOverflowing} />
      <StickToBottom.Content
        scrollClassName={SCROLL_CONTAINER_CLASS}
        className={cn(contentClassName)}
      >
        <div>
          {richChildren}
          {showCursor ? <ToolOutputCursor /> : null}
        </div>
      </StickToBottom.Content>
      {fog}
    </>
  )
}

export function ToolOutputViewport(props: ToolOutputViewportProps) {
  const { className } = props

  return (
    <StickToBottom
      className={cn(
        "relative max-h-52 overflow-hidden rounded-md bg-background/60",
        className
      )}
      initial="smooth"
      resize="smooth"
    >
      <ToolOutputViewportBody {...props} />
    </StickToBottom>
  )
}
