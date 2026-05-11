import { useCallback, useEffect, useRef, useState } from "react"
import type { PromptAttachmentFile } from "@workspace/ui/components/ai-elements/prompt-input"
import { usePromptInputAttachments } from "@workspace/ui/components/ai-elements/prompt-input"
import { uploadConversationFile, deleteConversationUpload } from "@/api/conversation"
import type { ChatPromptMessageStatus, UploadFileState } from "./types"

export function useChatPromptAttachmentUpload({
  conversationId,
  onAttachmentsChange,
  status,
}: {
  conversationId: string | number | null
  onAttachmentsChange: (paths: string[]) => void
  status: ChatPromptMessageStatus
}) {
  const attachments = usePromptInputAttachments()
  const prevStatusRef = useRef(status)
  useEffect(() => {
    if (prevStatusRef.current === "ready" && status === "submitted") {
      attachments.clear()
    }
    prevStatusRef.current = status
  }, [status, attachments])

  const [fileStates, setFileStates] = useState<Record<string, UploadFileState>>(
    {},
  )
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
        const fileObj = new File([blob], file.filename || "file", {
          type: file.mediaType,
        })
        const result = await uploadConversationFile(conversationId, fileObj)
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

  return {
    files: attachments.files,
    fileStates,
    handleRemove,
  }
}
