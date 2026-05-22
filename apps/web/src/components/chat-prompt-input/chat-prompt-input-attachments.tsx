import { cn } from "@workspace/ui/lib/utils"

import { useChatPromptAttachmentUpload } from "./use-chat-prompt-attachment-upload"
import { splitAttachmentsByImage } from "./attachment-filters"
import { ChatPromptImageAttachments } from "./chat-prompt-image-attachments"
import { ChatPromptFileAttachmentCard } from "./chat-prompt-file-attachment-card"
import type { ChatPromptMessageStatus } from "./types"

/** 随 PromptInput 容器宽度变化（compact 侧栏 ~400px 等） */
const FILE_ATTACHMENT_GRID =
  "grid w-full min-w-0 grid-cols-1 gap-1.5 @[18rem]/prompt-input:grid-cols-2 @[18rem]/prompt-input:gap-2 @[26rem]/prompt-input:grid-cols-3"

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
    <div
      className={cn(
        "flex w-full min-w-0 flex-col gap-1.5 px-1 pt-1.5",
        "@[18rem]/prompt-input:gap-2 @[18rem]/prompt-input:pt-2"
      )}
    >
      <ChatPromptImageAttachments
        files={imageFiles}
        fileStates={fileStates}
        conversationId={conversationId}
        onRemove={handleRemove}
      />
      {otherFiles.length > 0 && (
        <div className={FILE_ATTACHMENT_GRID}>
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
      )}
    </div>
  )
}
