import * as React from "react"
import {
  IconCheck,
  IconCopy,
  IconEdit,
  IconEye,
  IconMarkdown,
  IconMaximize,
  IconMinimize,
} from "@tabler/icons-react"
import CodeMirror from "@uiw/react-codemirror"
import { markdown, markdownLanguage } from "@codemirror/lang-markdown"
import { MessageResponse } from "@workspace/ui/components/ai-elements/message"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

type EditorMode = "edit" | "preview"

const markdownExtensions = [markdown({ base: markdownLanguage })]

/** 跟随 ThemeProvider 在 <html> 上切换的 light/dark class，保持编辑器主题同步。 */
function useIsDarkTheme(): boolean {
  const [isDark, setIsDark] = React.useState(
    () =>
      typeof document !== "undefined" &&
      document.documentElement.classList.contains("dark")
  )
  React.useEffect(() => {
    const root = document.documentElement
    const update = () => setIsDark(root.classList.contains("dark"))
    update()
    const observer = new MutationObserver(update)
    observer.observe(root, { attributes: true, attributeFilter: ["class"] })
    return () => observer.disconnect()
  }, [])
  return isDark
}

export function SkillMarkdownEditor({
  value,
  onChange,
  disabled = false,
  maximized = false,
  onToggleMaximize,
  className,
}: {
  value: string
  onChange: (next: string) => void
  disabled?: boolean
  maximized?: boolean
  onToggleMaximize?: () => void
  className?: string
}) {
  const [mode, setMode] = React.useState<EditorMode>("preview")
  const [copied, setCopied] = React.useState(false)
  const isDark = useIsDarkTheme()

  const charCount = value.length
  const lineCount = value ? value.split("\n").length : 0

  const handleCopy = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // 剪贴板不可用时静默忽略
    }
  }, [value])

  return (
    <div
      className={cn(
        "flex min-h-0 flex-col overflow-hidden rounded-lg border bg-card shadow-sm",
        // 最大化时填满外层容器（header 以下的区域）；否则使用固定高度，保证内部可滚动。
        maximized ? "h-full" : "h-[min(60vh,32rem)]",
        className
      )}
    >
      <div className="flex shrink-0 items-center gap-2 border-b bg-muted/40 px-3 py-1.5">
        <IconMarkdown className="size-4 shrink-0 text-muted-foreground" />
        <span className="font-mono text-xs font-medium text-foreground">
          SKILL.md
        </span>
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          Markdown
        </span>

        <div className="ml-auto flex items-center gap-1">
          <div className="flex items-center rounded-md border bg-background p-0.5">
            <ModeButton
              active={mode === "preview"}
              onClick={() => setMode("preview")}
              icon={<IconEye className="size-3.5" />}
              label="预览"
            />
            <ModeButton
              active={mode === "edit"}
              onClick={() => setMode("edit")}
              icon={<IconEdit className="size-3.5" />}
              label="编辑"
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-7 text-muted-foreground"
            onClick={() => void handleCopy()}
            aria-label="复制内容"
            title="复制内容"
          >
            {copied ? (
              <IconCheck className="size-3.5 text-emerald-600" />
            ) : (
              <IconCopy className="size-3.5" />
            )}
          </Button>
          {onToggleMaximize && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="size-7 text-muted-foreground"
              onClick={onToggleMaximize}
              aria-label={maximized ? "退出最大化" : "最大化"}
              title={maximized ? "退出最大化" : "最大化"}
            >
              {maximized ? (
                <IconMinimize className="size-3.5" />
              ) : (
                <IconMaximize className="size-3.5" />
              )}
            </Button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {mode === "edit" ? (
          <CodeMirror
            value={value}
            onChange={onChange}
            theme={isDark ? "dark" : "light"}
            editable={!disabled}
            readOnly={disabled}
            extensions={markdownExtensions}
            height="100%"
            className="h-full overflow-hidden text-[13px] [&_.cm-editor]:h-full [&_.cm-scroller]:overflow-auto"
            basicSetup={{
              lineNumbers: true,
              highlightActiveLine: true,
              highlightActiveLineGutter: true,
              foldGutter: false,
              bracketMatching: true,
              indentOnInput: true,
            }}
          />
        ) : (
          <div className="h-full overflow-auto bg-background">
            <div className="px-4 py-3">
              {value.trim() ? (
                <MessageResponse className="min-w-0 text-sm">
                  {value}
                </MessageResponse>
              ) : (
                <p className="text-sm text-muted-foreground">暂无内容可预览</p>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-3 border-t bg-muted/30 px-3 py-1 text-[11px] text-muted-foreground">
        <span>{lineCount} 行</span>
        <span>{charCount} 字符</span>
      </div>
    </div>
  )
}

function ModeButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors",
        active
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:text-foreground"
      )}
    >
      {icon}
      {label}
    </button>
  )
}
