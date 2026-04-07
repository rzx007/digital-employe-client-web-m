import { useState, useCallback, type ClipboardEventHandler } from "react"
import {
  useOptionalPromptInputController,
  usePromptInputAttachments,
} from "@workspace/ui/components/ai-elements/prompt-input"
import { cn } from "@workspace/ui/lib/utils"
import { LexicalComposer } from "@lexical/react/LexicalComposer"
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin"
import { ContentEditable } from "@lexical/react/LexicalContentEditable"
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin"
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import {
  $getRoot,
  $createParagraphNode,
  $createTextNode,
  COMMAND_PRIORITY_LOW,
  KEY_ENTER_COMMAND,
  KEY_BACKSPACE_COMMAND,
  $isElementNode,
} from "lexical"
import { useEffect, useRef } from "react"
import { CommandPillNode, $isCommandPillNode } from "./command-pill-node"
import {
  SlashCommandPlugin,
  type SlashCommandItem,
} from "./slash-command-plugin"

export interface PromptChangeEvent {
  value: string
  rawValue: string
  command: {
    id: string
    title: string
  } | null
}

function getEditorCommandAndValue(): PromptChangeEvent {
  const root = $getRoot()

  let command: PromptChangeEvent["command"] = null

  const topLevelChildren = root.getChildren()
  for (const child of topLevelChildren) {
    // 只关心段落等元素里的第一个命令 Pill
    if ($isElementNode(child)) {
      const grandChildren = child.getChildren()
      for (const node of grandChildren as unknown as CommandPillNode[]) {
        if ($isCommandPillNode(node)) {
          const latest = node.getLatest() as CommandPillNode
          command = {
            id: latest.getCommandId(),
            title: latest.getCommandTitle(),
          }
          break
        }
      }
      if (command) break
    }
  }

  const value = root.getTextContent()
  const rawValue = command ? `/${command.title}` : `${value}`
  return {
    value,
    rawValue,
    command,
  }
}

// 同步外部值到 Lexical，并同步 Lexical 状态到外部值
function OnChangePlugin({
  value,
  onChange,
}: {
  value: string
  onChange?: (e: PromptChangeEvent) => void
}) {
  const [editor] = useLexicalComposerContext()
  const isUpdatingRef = useRef(false)

  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      // 只更新外部状态，如果更新来自用户输入，而不是外部属性
      if (isUpdatingRef.current) {
        return
      }

      editorState.read(() => {
        const {
          value: nextValue,
          rawValue,
          command,
        } = getEditorCommandAndValue()

        if (nextValue !== value && onChange) {
          onChange({
            value: nextValue,
            rawValue,
            command,
          })
        }
      })
    })
  }, [editor, onChange, value])

  useEffect(() => {
    // 初始化同步外部值到 Lexical，或设置初始状态
    editor.getEditorState().read(() => {
      const currentText = $getRoot().getTextContent()
      if (value !== currentText) {
        isUpdatingRef.current = true
        editor.update(() => {
          const root = $getRoot()
          root.clear()
          if (value) {
            const paragraph = $createParagraphNode()
            paragraph.append($createTextNode(value))
            root.append(paragraph)
          }
        })
        queueMicrotask(() => {
          isUpdatingRef.current = false
        })
      }
    })
  }, [value, editor])

  return null
}

// 拦截 Enter 键事件
function SubmitKeyPlugin() {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    return editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event: KeyboardEvent) => {
        if (event.shiftKey) {
          return false // 让 Lexical 处理默认新行
        }

        // 找到最近的表单并提交
        const editorElement = editor.getRootElement()
        const form = editorElement?.closest("form")
        if (form) {
          const submitButton = form.querySelector(
            'button[type="submit"]'
          ) as HTMLButtonElement | null
          if (!submitButton?.disabled) {
            event.preventDefault()
            form.requestSubmit()
            return true
          }
        }
        return false
      },
      COMMAND_PRIORITY_LOW
    )
  }, [editor])

  return null
}

// 拦截 Backspace 键事件
function BackspaceAttachmentPlugin({
  attachments,
}: {
  attachments: ReturnType<typeof usePromptInputAttachments>
}) {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    return editor.registerCommand(
      KEY_BACKSPACE_COMMAND,
      (event: KeyboardEvent) => {
        let isHandled = false
        editor.getEditorState().read(() => {
          const text = $getRoot().getTextContent()
          if (text === "" && attachments.files.length > 0) {
            event.preventDefault()
            const lastAttachment = attachments.files.at(-1)
            if (lastAttachment) {
              attachments.remove(lastAttachment.id)
            }
            isHandled = true
          }
        })
        return isHandled
      },
      COMMAND_PRIORITY_LOW
    )
  }, [editor, attachments])

  return null
}

// 挂载后自动聚焦到编辑器
function FocusOnMountPlugin({ autoFocus }: { autoFocus: boolean }) {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    if (!autoFocus) return
    const id = requestAnimationFrame(() => {
      editor.focus()
    })
    return () => cancelAnimationFrame(id)
  }, [editor, autoFocus])

  return null
}

// 占位符
function Placeholder({
  placeholder,
  className,
}: {
  placeholder: string
  className?: string
}) {
  return (
    <div
      className={cn(
        "pointer-events-none absolute -top-1 left-4 text-base text-muted-foreground/60",
        className
      )}
    >
      {placeholder}
    </div>
  )
}

// 属性类型
export interface LexicalPromptInputTextareaProps {
  value?: string
  onChange?: (e: PromptChangeEvent) => void
  placeholder?: string
  className?: string
  /** 挂载后是否自动聚焦到输入框，默认 true */
  autoFocus?: boolean
  /** 斜杠命令选项，不传则不启用斜杠命令 */
  commands?: SlashCommandItem[]
}

// 组件
export function LexicalPromptInputTextarea({
  onChange,
  className,
  placeholder = "请输入任务...",
  value: propValue,
  autoFocus = true,
  commands,
}: LexicalPromptInputTextareaProps) {
  const controller = useOptionalPromptInputController()
  const attachments = usePromptInputAttachments()
  const [isComposing, setIsComposing] = useState(false)

  // 粘贴事件
  const handlePaste: ClipboardEventHandler<HTMLDivElement> = useCallback(
    (event) => {
      const items = event.clipboardData?.items

      if (!items) {
        return
      }

      const files: File[] = []

      for (const item of items) {
        if (item.kind === "file") {
          const file = item.getAsFile()
          if (file) {
            files.push(file)
          }
        }
      }

      if (files.length > 0) {
        event.preventDefault()
        attachments.add(files)
      }
    },
    [attachments]
  )

  // 组合结束事件
  const handleCompositionEnd = useCallback(() => {
    setIsComposing(false)
  }, [])
  // 组合开始事件
  const handleCompositionStart = useCallback(() => {
    setIsComposing(true)
  }, [])

  const value = controller ? controller.textInput.value : propValue || ""

  // Lexical 默认不输出原生隐藏输入框，
  // 所以我们需要注入一个隐藏输入框来保持原生表单数据同步
  // 当使用 PromptInput 但没有 Provider 时。
  const hiddenInputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!controller && hiddenInputRef.current) {
      hiddenInputRef.current.value = value
    }
  }, [value, controller])

  const handleChange = controller
    ? (e: PromptChangeEvent) => {
      controller.textInput.setInput(e.value)
      onChange?.(e)
    }
    : (e: PromptChangeEvent) => onChange?.(e)

  const initialConfig = {
    namespace: "PromptInputEditor",
    theme: {
      paragraph: "m-0",
      text: {
        bold: "font-bold",
        italic: "italic",
        underline: "underline",
        strikethrough: "line-through",
      },
    },
    nodes: [CommandPillNode],
    onError(error: Error) {
      console.error(error)
    },
  }

  return (
    <LexicalComposer initialConfig={initialConfig}>
      {/* 隐藏输入框来同步值到原生表单数据，如果未使用 PromptInputController */}
      {!controller && (
        <input
          type="hidden"
          name="message"
          ref={hiddenInputRef}
          value={value}
        />
      )}
      <div
        className={cn("relative flex w-full flex-1 flex-col", className)}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
        onPaste={handlePaste}
      >
        <RichTextPlugin
          contentEditable={
            <ContentEditable
              data-slot="input-group-control"
              className={cn(
                "h-full w-full flex-1 resize-none rounded-none border-0 bg-transparent px-4 shadow-none ring-0 focus-visible:outline-none disabled:bg-transparent aria-invalid:ring-0 dark:bg-transparent dark:disabled:bg-transparent",
                className
              )}
            />
          }
          placeholder={
            <Placeholder placeholder={placeholder} className="py-2" />
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
        <HistoryPlugin />
        <OnChangePlugin value={value} onChange={handleChange} />
        <FocusOnMountPlugin autoFocus={autoFocus} />
        {!isComposing && <SubmitKeyPlugin />}
        <BackspaceAttachmentPlugin attachments={attachments} />
        <SlashCommandPlugin commands={commands} />
      </div>
    </LexicalComposer>
  )
}
