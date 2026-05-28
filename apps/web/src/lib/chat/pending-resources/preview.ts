import type { PendingResource } from "./types"

export interface PendingPreviewFlags {
  isPendingDocStreaming: boolean
  skipApiContentFetch: boolean
  shouldUsePendingContent: boolean
}

export function getPendingPreviewFlags(
  selectedPending: PendingResource | null,
  isDocFile: boolean,
  hasResourceContent: boolean
): PendingPreviewFlags {
  const isPendingDocStreaming =
    isDocFile && selectedPending?.isStreaming === true
  const skipApiContentFetch =
    !!selectedPending && !isDocFile && selectedPending.isStreaming === true
  const shouldUsePendingContent =
    !!selectedPending &&
    !isDocFile &&
    (selectedPending.isStreaming || !hasResourceContent)

  return { isPendingDocStreaming, skipApiContentFetch, shouldUsePendingContent }
}
