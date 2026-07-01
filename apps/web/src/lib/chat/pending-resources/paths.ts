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
  // 去虚拟前缀后路径均为真实绝对路径；这里只把反斜杠统一为正斜杠便于解析。
  return path.replace(/\\/g, "/")
}

/**
 * 推导路径所属交付物桶。去虚拟前缀后路径是真实绝对路径，但物理目录结构未变——
 * 真实路径里仍含 `artifacts/`、`uploads/`、`skills-draft/` 目录段，按段匹配即可。
 * 优先级：skills-draft > uploads > artifacts。
 */
export function getResourceBucket(path: string): ResourceBucket | null {
  const p = path.replace(/\\/g, "/")
  if (/(^|\/)skills-draft(\/|$)/.test(p)) return "skills_draft"
  if (/(^|\/)uploads(\/|$)/.test(p)) return "uploads"
  if (/(^|\/)artifacts(\/|$)/.test(p)) return "artifacts"
  return null
}

/** 取路径中桶段之后的相对部分（含文件名），用于构建工作台文件树。无桶段返回 basename。 */
export function toBucketRelativeSegments(path: string): string[] {
  const p = path.replace(/\\/g, "/")
  // 必须锚定路径**所属的桶**（getResourceBucket 已按 skills-draft > uploads >
  // artifacts 的优先级判定），不能用「artifacts|uploads|skills-draft」首个出现者：
  // 草稿技能真实路径形如 .../artifacts/conv-N/skills-draft/<skill>/...，同时含
  // artifacts 与 skills-draft 段，旧正则会锚到靠前的 artifacts，rel[0] 错成 conv-N
  // （save-draft 拿到错误 skillName → 404）。
  const bucket = getResourceBucket(p)
  if (bucket) {
    const seg = getBucketRootSegment(bucket)
    const m = p.match(new RegExp(`(?:^|/)${seg}/(.+)$`))
    if (m && m[1]) return m[1].split("/").filter(Boolean)
  }
  const segs = p.split("/").filter(Boolean)
  const last = segs.at(-1)
  return last ? [last] : []
}

export function isConversationResourcePath(path: string): boolean {
  const normalized = normalizeToolFilePath(path)
  return getResourceBucket(normalized) !== null
}

export function isArtifactLikePath(path: string): boolean {
  return isConversationResourcePath(path)
}
