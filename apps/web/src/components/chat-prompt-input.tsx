import { useCallback, useEffect, useRef, useState } from "react"
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
  type PromptAttachmentFile,
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
import { uploadConversationFile, deleteConversationUpload } from "@/api/conversation"
import { getFileIcon } from "@/lib/chat/file-icons"

const ACCEPTED_FILE_TYPES =
  ".txt,.md,.csv,.tsv,.json,.xml,.yaml,.yml,.toml,.ini,.cfg,.conf,.log,.env," +
  ".py,.js,.ts,.tsx,.jsx,.html,.css,.scss,.less,.vue,.svelte," +
  ".java,.go,.rs,.c,.cpp,.h,.hpp,.cs,.rb,.php,.swift,.kt,.scala," +
  ".sh,.bash,.zsh,.sql,.r,.m," +
  ".png,.jpg,.jpeg,.gif,.svg,.webp," +
  ".geojson,.jsonl,.ndjson"

const MAX_UPLOAD_SIZE_BYTES = 200 * 1024 * 1024

const ONE_MB_BYTES = 1024 * 1024

function formatAttachmentDisplaySize(bytes: number): string {
  if (bytes < ONE_MB_BYTES) {
    const kb = bytes / 1024
    return kb < 10 ? `${kb.toFixed(1)} KB` : `${Math.round(kb)} KB`
  }
  const mb = bytes / ONE_MB_BYTES
  return mb < 10 ? `${mb.toFixed(1)} MB` : `${Math.round(mb)} MB`
}

type FileUploadStatus = "uploading" | "done" | "error"

interface UploadFileState {
  id: string
  filename: string
  status: FileUploadStatus
  path?: string
  error?: string
  sizeBytes?: number
}

function ChatPromptInputAttachments({
  conversationId,
  onAttachmentsChange,
  status,
}: {
  conversationId: string | number | null
  onAttachmentsChange: (paths: string[]) => void
  status: "submitted" | "streaming" | "ready" | "error"
}) {
  const attachments = usePromptInputAttachments()
  // 发送消息后清空附件
  const prevStatusRef = useRef(status)
  useEffect(() => {
    if (prevStatusRef.current === "ready" && status === "submitted") {
      attachments.clear()
    }
    prevStatusRef.current = status
  }, [status, attachments])
  // useEffect(() => {
  //   console.log(111, attachments.files)
  // }, [attachments.files])
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
    async (file: PromptAttachmentFile) => {
      if (!conversationId) return
      const sizeBytes = file.sizeBytes
      setFileStates((prev) => ({
        ...prev,
        [file.id]: {
          id: file.id,
          filename: file.filename || "unknown",
          status: "uploading",
          sizeBytes,
        },
      }))
      try {
        const response = await fetch(file.url)
        const blob = await response.blob()
        const resolvedSize = sizeBytes ?? blob.size
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
              sizeBytes: resolvedSize,
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
            sizeBytes: prev[file.id]?.sizeBytes ?? sizeBytes,
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
              sizeBytes: f.sizeBytes,
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

  const handleRemove = useCallback(
    async (fileId: string) => {
      const state = fileStates[fileId]
      if (conversationId && state?.status === "done" && state.path) {
        try {
          await deleteConversationUpload(conversationId, state.path)
        } catch {
          // 删除远端附件失败时仍允许从输入区移除
        }
      }
      attachments.remove(fileId)
    },
    [attachments, conversationId, fileStates],
  )

  if (attachments.files.length === 0) return null

  return (
    <div className="grid w-full grid-cols-2 gap-2 px-1 pt-2 lg:grid-cols-3">
      {attachments.files.map((file) => {
        const state = fileStates[file.id]
        const filename = file.filename || "unknown"
        const sizeBytes = state?.sizeBytes ?? file.sizeBytes

        let statusLabel: React.ReactNode = null
        if (!conversationId) {
          statusLabel = (
            <span className="shrink-0 rounded-full bg-yellow-100 px-1.5 py-0.5 text-[9px] text-yellow-700">
              待上传
            </span>
          )
        } else if (state?.status === "uploading") {
          statusLabel = (
            <span className="flex shrink-0 items-center gap-1 text-[9px] text-muted-foreground">
              <Spinner className="size-2.5" />
              上传中
            </span>
          )
        } else if (state?.status === "done") {
          statusLabel = (
            <span className="shrink-0 rounded-full bg-green-100 px-1.5 py-0.5 text-[9px] text-green-700">
              已上传
            </span>
          )
        } else if (state?.status === "error") {
          statusLabel = (
            <span
              className="shrink-0 cursor-help rounded-full bg-red-100 px-1.5 py-0.5 text-[9px] text-red-700"
              title={state.error}
            >
              上传失败
            </span>
          )
        }

        return (
          <div
            key={file.id}
            className="group relative flex w-full min-w-0 items-center gap-2 rounded-md border border-border/50 bg-background/70 px-2 py-1.5"
          >
            <button
              type="button"
              className="absolute -top-1 -right-1 flex size-4 cursor-pointer items-center justify-center rounded-full border border-border/50 bg-background text-muted-foreground opacity-0 shadow-sm transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100"
              onClick={() => handleRemove(file.id)}
              aria-label="移除附件"
            >
              <svg
                width="10"
                height="10"
                viewBox="0 0 12 12"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              >
                <path d="M3 3l6 6M9 3l-6 6" />
              </svg>
            </button>
            <img
              alt=""
              aria-hidden="true"
              className="size-7 shrink-0"
              draggable={false}
              src={getFileIcon(filename)}
            />
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 w-full flex-col gap-0.5">
                <span
                  className="min-w-0 truncate text-[11px] text-foreground"
                  title={filename}
                >
                  {filename}
                </span>
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  {formatAttachmentDisplaySize(sizeBytes)}&nbsp;{statusLabel}
                </span>
                {/* <div className="flex shrink-0 items-start">{statusLabel}</div> */}
              </div>
            </div>
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
              status={status}
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
              <PromptInputActionMenuContent className="w-48">
                <PromptInputActionAddAttachments className="w-full" label="上传文件或图片" />
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
