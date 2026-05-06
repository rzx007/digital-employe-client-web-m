import { useCallback, useEffect, useRef, useState } from "react"
import type { FileUIPart } from "ai"
import type { PromptInputMessage } from "@workspace/ui/components/ai-elements/prompt-input"
import {
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuTrigger,
  PromptInputBody,
  PromptInputFooter,
  PromptInputHeader,
  PromptInputSubmit,
  PromptInputTools,
  usePromptInputAttachments,
} from "@workspace/ui/components/ai-elements/prompt-input"
import {
  LexicalPromptInputTextarea,
  type PromptChangeEvent,
} from "./lexical-editor/prompt-input-textarea"
import type { SlashCommandItem } from "./lexical-editor/slash-command-plugin"
import type { MentionCandidate } from "./lexical-editor/mention-plugin"
import { Separator } from "@workspace/ui/components/separator"
import { Spinner } from "@/components/spinner"
import { uploadConversationFile } from "@/api/conversation"

const ACCEPTED_FILE_TYPES =
  ".txt,.md,.csv,.tsv,.json,.xml,.yaml,.yml,.toml,.ini,.cfg,.conf,.log,.env," +
  ".py,.js,.ts,.tsx,.jsx,.html,.css,.scss,.less,.vue,.svelte," +
  ".java,.go,.rs,.c,.cpp,.h,.hpp,.cs,.rb,.php,.swift,.kt,.scala," +
  ".sh,.bash,.zsh,.sql,.r,.m," +
  ".png,.jpg,.jpeg,.gif,.svg,.webp," +
  ".geojson,.jsonl,.ndjson"

const MAX_UPLOAD_SIZE_BYTES = 200 * 1024 * 1024

type FileUploadStatus = "uploading" | "done" | "error"

interface UploadFileState {
  id: string
  filename: string
  status: FileUploadStatus
  path?: string
  error?: string
}

function ChatPromptInputAttachments({
  conversationId,
  onAttachmentsChange,
}: {
  conversationId: string | number | null
  onAttachmentsChange: (paths: string[]) => void
}) {
  const attachments = usePromptInputAttachments()
  const [fileStates, setFileStates] = useState<
    Record<string, UploadFileState>
  >({})
  const handledIdsRef = useRef<Set<string>>(new Set())
  const pathsRef = useRef<string[]>([])
  const reportPathsRef = useRef(onAttachmentsChange)

  reportPathsRef.current = onAttachmentsChange

  const reportPaths = useCallback(() => {
    const paths: string[] = []
    for (const f of attachments.files) {
      const state = fileStates[f.id]
      if (state?.status === "done" && state.path) {
        paths.push(state.path)
      }
    }
    if (
      paths.length !== pathsRef.current.length ||
      !paths.every((p, i) => p === pathsRef.current[i])
    ) {
      pathsRef.current = paths
      reportPathsRef.current(paths)
    }
  }, [attachments.files, fileStates])

  useEffect(() => {
    reportPaths()
  }, [reportPaths])

  const uploadFile = useCallback(
    async (file: FileUIPart & { id: string }) => {
      if (!conversationId) return
      setFileStates((prev) => ({
        ...prev,
        [file.id]: {
          id: file.id,
          filename: file.filename || "unknown",
          status: "uploading",
        },
      }))
      try {
        const response = await fetch(file.url)
        const blob = await response.blob()
        const fileObj = new File(
          [blob],
          file.filename || "file",
          { type: file.mediaType },
        )
        const result = await uploadConversationFile(
          conversationId,
          fileObj,
        )
        if (result?.data?.path) {
          setFileStates((prev) => ({
            ...prev,
            [file.id]: {
              id: file.id,
              filename: file.filename || "unknown",
              status: "done",
              path: result.data.path,
            },
          }))
        } else {
          throw new Error(result?.msg || "上传失败")
        }
      } catch (err) {
        setFileStates((prev) => ({
          ...prev,
          [file.id]: {
            id: file.id,
            filename: file.filename || "unknown",
            status: "error",
            error: err instanceof Error ? err.message : "上传失败",
          },
        }))
      }
    },
    [conversationId],
  )

  useEffect(() => {
    const currentIds = new Set(attachments.files.map((f) => f.id))

    for (const f of attachments.files) {
      if (!handledIdsRef.current.has(f.id)) {
        handledIdsRef.current.add(f.id)
        if (conversationId) {
          uploadFile(f)
        } else {
          setFileStates((prev) => ({
            ...prev,
            [f.id]: {
              id: f.id,
              filename: f.filename || "unknown",
              status: "uploading",
            },
          }))
        }
      }
    }

    for (const id of handledIdsRef.current) {
      if (!currentIds.has(id)) {
        handledIdsRef.current.delete(id)
        setFileStates((prev) => {
          const next = { ...prev }
          delete next[id]
          return next
        })
      }
    }
  }, [attachments.files, conversationId, uploadFile])

  if (attachments.files.length === 0) return null

  return (
    <div className="flex flex-wrap gap-1.5 px-1 pt-2">
      {attachments.files.map((file) => {
        const state = fileStates[file.id]
        const filename = file.filename || "unknown"

        let statusEl: React.ReactNode = null
        if (!conversationId) {
          statusEl = (
            <span className="shrink-0 text-yellow-500 text-[10px]">
              待上传
            </span>
          )
        } else if (state?.status === "uploading") {
          statusEl = <Spinner className="size-3 shrink-0" />
        } else if (state?.status === "done") {
          statusEl = (
            <span className="shrink-0 text-green-500">&#10003;</span>
          )
        } else if (state?.status === "error") {
          statusEl = (
            <span
              className="shrink-0 cursor-help text-red-500"
              title={state.error}
            >
              &#10007;
            </span>
          )
        }

        return (
          <div
            key={file.id}
            className="flex max-w-48 items-center gap-1 rounded-md border bg-muted/50 px-2 py-1 text-xs"
          >
            {statusEl}
            <span className="min-w-0 truncate">{filename}</span>
          </div>
        )
      })}
    </div>
  )
}

interface ChatPromptInputProps {
  value: string
  onChange: (e: PromptChangeEvent) => void
  onSubmit: (message: PromptInputMessage) => void
  onStop?: () => void
  status: "submitted" | "streaming" | "ready" | "error"
  disabled?: boolean
  placeholder?: string
  size?: "default" | "compact"
  className?: string
  slashCommands?: SlashCommandItem[]
  mentionCandidates?: MentionCandidate[]
  conversationId?: string | number | null
  onAttachmentsChange?: (paths: string[]) => void
}

export function ChatPromptInput({
  value,
  onChange,
  onSubmit,
  onStop,
  status,
  disabled,
  placeholder = "请输入任务，然后交给我",
  size = "default",
  className,
  slashCommands,
  mentionCandidates,
  conversationId,
  onAttachmentsChange,
}: ChatPromptInputProps) {
  const isCompact = size === "compact"

  return (
    <div className={className}>
      <PromptInput
        globalDrop
        multiple
        accept={ACCEPTED_FILE_TYPES}
        maxFileSize={MAX_UPLOAD_SIZE_BYTES}
        maxFiles={10}
        onSubmit={onSubmit}
        className=""
      >
        <PromptInputHeader>
          {onAttachmentsChange && (
            <ChatPromptInputAttachments
              conversationId={conversationId ?? null}
              onAttachmentsChange={onAttachmentsChange}
            />
          )}
        </PromptInputHeader>
        <PromptInputBody
          className={isCompact ? "min-h-[60px]" : "min-h-[100px]"}
        >
          <LexicalPromptInputTextarea
            onChange={onChange}
            value={value}
            placeholder={placeholder}
            commands={slashCommands}
            mentionCandidates={mentionCandidates}
            disabled={false}
            className={`resize-none placeholder:text-muted-foreground/60 ${isCompact ? "min-h-[60px] text-base" : "min-h-28 text-lg"}`}
          />
        </PromptInputBody>
        <PromptInputFooter>
          <PromptInputTools>
            <PromptInputActionMenu>
              <PromptInputActionMenuTrigger />
              <PromptInputActionMenuContent>
                <PromptInputActionAddAttachments />
              </PromptInputActionMenuContent>
            </PromptInputActionMenu>
            <Separator orientation="vertical" className="h-3 mt-2 mr-3" />
          </PromptInputTools>
          <PromptInputTools>
            <PromptInputSubmit
              disabled={disabled}
              status={status}
              onStop={onStop}
              className="bg-primary/80 transition-colors hover:bg-primary"
            />
          </PromptInputTools>
        </PromptInputFooter>
      </PromptInput>
    </div>
  )
}
