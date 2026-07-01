import type { PromptAttachmentFile } from "@workspace/ui/components/ai-elements/prompt-input"
import { IMAGE_EXTENSIONS } from "./constants"

export function getFilenameExtension(filename: string): string {
  const i = filename.lastIndexOf(".")
  return i >= 0 ? filename.slice(i + 1).toLowerCase() : ""
}

export function isImageAttachment(file: PromptAttachmentFile): boolean {
  return IMAGE_EXTENSIONS.has(getFilenameExtension(file.filename || ""))
}

export function splitAttachmentsByImage(files: PromptAttachmentFile[]): {
  imageFiles: PromptAttachmentFile[]
  otherFiles: PromptAttachmentFile[]
} {
  const imageFiles: PromptAttachmentFile[] = []
  const otherFiles: PromptAttachmentFile[] = []
  for (const f of files) {
    if (isImageAttachment(f)) {
      imageFiles.push(f)
    } else {
      otherFiles.push(f)
    }
  }
  return { imageFiles, otherFiles }
}
