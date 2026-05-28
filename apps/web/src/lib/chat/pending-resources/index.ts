export type {
  ClearPendingResourceRef,
  PendingResource,
  UpsertPendingResourceInput,
} from "./types"

export {
  RESOURCE_TREE_ROOTS,
  getBucketRootSegment,
  getResourceBucket,
  isArtifactLikePath,
  isConversationResourcePath,
  normalizeToolFilePath,
  type ResourceBucket,
} from "./paths"

export {
  collectAllResourcePaths,
  dedupePendingList,
  findEntryByPath,
  findPendingByPath,
  flattenResourceListEntries,
  mergePendingIntoEntries,
  mergePendingIntoResourceList,
  pendingToResourceEntry,
  resolveResourceEntryWithPending,
} from "./merge"

export {
  getPendingDisplayName,
  isPathStableForPendingTree,
  shouldMergePendingIntoTree,
} from "./path-stability"

export {
  getPendingPreviewFlags,
  getPendingPreviewState,
  type ArtifactPreviewPhase,
  type PendingPreviewFlags,
  type PendingPreviewState,
} from "./preview"

export {
  isDocumentPath,
  isHtmlPath,
  isMarkdownPath,
  resolveRendererKindFromPath,
  resolveStreamingPreviewMode,
  type ArtifactRendererKind,
  type StreamingPreviewMode,
} from "./preview-streaming"

export { useConversationPendingResources } from "./use-conversation-pending-resources"
