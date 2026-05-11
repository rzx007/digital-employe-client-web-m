import { useChatPromptAttachmentUpload } from "./use-chat-prompt-attachment-upload"
import { splitAttachmentsByImage } from "./attachment-filters"
import { ChatPromptImageAttachments } from "./chat-prompt-image-attachments"
import { ChatPromptFileAttachmentCard } from "./chat-prompt-file-attachment-card"
import type { ChatPromptMessageStatus } from "./types"

export function ChatPromptInputAttachments({
  conversationId,
  onAttachmentsChange,
  status,
}: {
  conversationId: string | number | null
  onAttachmentsChange: (paths: string[]) => void
  status: ChatPromptMessageStatus
}) {
  const { files, fileStates, handleRemove } = useChatPromptAttachmentUpload({
    conversationId,
    onAttachmentsChange,
    status,
  })

  if (files.length === 0) return null

  const { imageFiles, otherFiles } = splitAttachmentsByImage(files)

  return (
    <div className="flex w-full flex-wrap items-start gap-2 px-1 pt-2">
      <ChatPromptImageAttachments
        files={imageFiles}
        fileStates={fileStates}
        conversationId={conversationId}
        onRemove={handleRemove}
      />
      {otherFiles.map((file) => (
        <ChatPromptFileAttachmentCard
          key={file.id}
          file={file}
          state={fileStates[file.id]}
          conversationId={conversationId}
          onRemove={() => handleRemove(file.id)}
        />
      ))}
    </div>
  )
}
