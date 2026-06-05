import { isHtmlPath } from "@/components/artifact/artifact-content/resolve-renderer"

export interface FileOpenHandlers {
  conversationId: string | number | null | undefined
  openHtmlPreview: (conversationId: string | number, path: string) => void
  openResource: (path: string) => void
}

export function resolveFileOpen(path: string, h: FileOpenHandlers): void {
  if (isHtmlPath(path) && h.conversationId != null) {
    h.openHtmlPreview(h.conversationId, path)
    return
  }
  h.openResource(path)
}
