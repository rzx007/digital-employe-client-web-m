import type { ResourceList } from "@/api/types"

export type ResourceBucket = keyof Pick<
  ResourceList,
  "artifacts" | "uploads" | "skills_draft"
>

/** 与 ArtifactPanel FileTreeFolder 根节点一致 */
export const RESOURCE_TREE_ROOTS = [
  {
    path: "/artifacts",
    listKey: "artifacts" as const,
    label: "产物",
    segment: "artifacts",
  },
  {
    path: "/uploads",
    listKey: "uploads" as const,
    label: "上传文件",
    segment: "uploads",
  },
  {
    path: "/skills-draft",
    listKey: "skills_draft" as const,
    label: "技能草稿",
    segment: "skills-draft",
  },
] as const

const BUCKET_ROOT_SEGMENT: Record<ResourceBucket, string> = {
  artifacts: "artifacts",
  uploads: "uploads",
  skills_draft: "skills-draft",
}

export function getBucketRootSegment(bucket: ResourceBucket): string {
  return BUCKET_ROOT_SEGMENT[bucket]
}

export function normalizeToolFilePath(path: string): string {
  const normalized = path.replace(/\\/g, "/")
  if (
    normalized.startsWith("artifacts/") ||
    normalized.startsWith("uploads/") ||
    normalized.startsWith("skills-draft/")
  ) {
    return `/${normalized}`
  }
  return normalized
}

export function getResourceBucket(path: string): ResourceBucket | null {
  if (path.startsWith("/artifacts/")) return "artifacts"
  if (path.startsWith("/uploads/")) return "uploads"
  if (path.startsWith("/skills-draft/")) return "skills_draft"
  return null
}

export function isConversationResourcePath(path: string): boolean {
  const normalized = normalizeToolFilePath(path)
  return getResourceBucket(normalized) !== null
}

export function isArtifactLikePath(path: string): boolean {
  return isConversationResourcePath(path)
}
