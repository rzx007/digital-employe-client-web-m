export type { PendingResource, UpsertPendingResourceInput } from "./types"

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
  findEntryByPath,
  findPendingByPath,
  flattenResourceListEntries,
  mergePendingIntoEntries,
  mergePendingIntoResourceList,
  pendingToResourceEntry,
  resolveResourceEntryWithPending,
} from "./merge"

export { getPendingPreviewFlags, type PendingPreviewFlags } from "./preview"

export {
  useSyncPendingResourceFromTool,
  type SyncPendingResourceFromToolInput,
} from "./sync-from-tool"

export { useConversationPendingResources } from "./use-conversation-pending-resources"
