import type { ResourceEntry, ResourceList } from "@/api/types"

import {
  getResourceBucket,
  toBucketRelativeSegments,
  type ResourceBucket,
} from "./paths"
import {
  getPendingDisplayName,
  shouldMergePendingIntoTree,
} from "./path-stability"
import type { PendingResource } from "./types"

function inferArtifactType(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? ""
  if (["png", "jpg", "jpeg", "gif", "svg", "webp"].includes(ext)) {
    return "image"
  }
  if (["csv", "tsv", "xlsx", "xls"].includes(ext)) {
    return "sheet"
  }
  if (
    ["py", "js", "ts", "tsx", "jsx", "go", "rs", "java", "cpp", "c", "sh"].includes(
      ext
    )
  ) {
    return "code"
  }
  if (getResourceBucket(path) === "skills_draft") {
    return "skill-draft"
  }
  if (["pdf", "doc", "docx", "ppt", "pptx"].includes(ext)) {
    return "document"
  }
  return "text"
}

/** 同一 toolCall 只保留最新 path，避免流式路径前缀产生多条 pending */
export function dedupePendingList(
  pendingList: PendingResource[]
): PendingResource[] {
  const byToolCallId = new Map<string, PendingResource>()
  const byPathLegacy = new Map<string, PendingResource>()

  for (const pending of pendingList) {
    if (pending.toolCallId) {
      const existing = byToolCallId.get(pending.toolCallId)
      if (!existing || pending.updatedAt >= existing.updatedAt) {
        byToolCallId.set(pending.toolCallId, pending)
      }
      continue
    }
    const existing = byPathLegacy.get(pending.path)
    if (!existing || pending.updatedAt >= existing.updatedAt) {
      byPathLegacy.set(pending.path, pending)
    }
  }

  return [...byPathLegacy.values(), ...byToolCallId.values()]
}

export function pendingToResourceEntry(pending: PendingResource): ResourceEntry {
  // 归一化为正斜杠，与后端 as_posix 路径一致，保证树内/选中按路径相等比较命中。
  const path = pending.path.replace(/\\/g, "/")
  return {
    name: getPendingDisplayName(pending),
    path,
    entry_type: "file",
    artifact_type: inferArtifactType(path),
    size: pending.content.length,
    modified_at: null,
    children: null,
  }
}

export function findEntryByPath(
  entries: ResourceEntry[],
  path: string
): ResourceEntry | null {
  for (const entry of entries) {
    if (entry.path === path) return entry
    if (entry.children) {
      const found = findEntryByPath(entry.children, path)
      if (found) return found
    }
  }
  return null
}

function pathExistsInTree(entries: ResourceEntry[], path: string): boolean {
  return findEntryByPath(entries, path) !== null
}

function insertFileEntry(
  entries: ResourceEntry[],
  fileEntry: ResourceEntry,
  _bucket: ResourceBucket
): ResourceEntry[] {
  const path = fileEntry.path.replace(/\\/g, "/")
  if (pathExistsInTree(entries, path)) {
    return entries
  }

  // 真实绝对路径：取桶段之后的相对部分构建树；桶根绝对路径用于拼接目录节点 path
  // （与后端 as_posix 目录条目 path 一致）。
  const rel = toBucketRelativeSegments(path)
  if (rel.length < 1) {
    return entries
  }
  const relJoined = rel.join("/")
  const idx = path.lastIndexOf("/" + relJoined)
  if (idx < 0) {
    return entries
  }
  const bucketRootAbs = path.slice(0, idx)

  const dirSegments = rel.slice(0, -1)

  function insertAt(
    current: ResourceEntry[],
    depth: number
  ): ResourceEntry[] {
    if (depth >= dirSegments.length) {
      return [...current, fileEntry]
    }

    const dirName = dirSegments[depth]!
    const dirPath = `${bucketRootAbs}/${dirSegments.slice(0, depth + 1).join("/")}`
    const existingIndex = current.findIndex(
      (e) => e.path === dirPath && e.entry_type === "directory"
    )

    if (existingIndex >= 0) {
      const existing = current[existingIndex]!
      const updated: ResourceEntry = {
        ...existing,
        children: insertAt(existing.children ?? [], depth + 1),
      }
      return current.map((e, i) => (i === existingIndex ? updated : e))
    }

    const newDir: ResourceEntry = {
      name: dirName,
      path: dirPath,
      entry_type: "directory",
      artifact_type: null,
      size: 0,
      modified_at: null,
      children:
        depth + 1 >= dirSegments.length
          ? [fileEntry]
          : insertAt([], depth + 1),
    }

    return [...current, newDir].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
    )
  }

  return insertAt(entries, 0)
}

export function mergePendingIntoEntries(
  entries: ResourceEntry[],
  pendingList: PendingResource[],
  bucket: ResourceBucket
): ResourceEntry[] {
  let merged = entries
  for (const pending of dedupePendingList(pendingList)) {
    if (getResourceBucket(pending.path) !== bucket) continue
    if (!shouldMergePendingIntoTree(pending)) continue
    if (pathExistsInTree(merged, pending.path)) continue
    merged = insertFileEntry(merged, pendingToResourceEntry(pending), bucket)
  }
  return merged
}

export function mergePendingIntoResourceList(
  list: ResourceList,
  pendingList: PendingResource[]
): ResourceList {
  const deduped = dedupePendingList(pendingList)
  return {
    artifacts: mergePendingIntoEntries(list.artifacts, deduped, "artifacts"),
    uploads: mergePendingIntoEntries(list.uploads, deduped, "uploads"),
    skills_draft: mergePendingIntoEntries(
      list.skills_draft,
      deduped,
      "skills_draft"
    ),
  }
}

export function findPendingByPath(
  pendingList: PendingResource[],
  path: string | null
): PendingResource | null {
  if (!path) return null
  return pendingList.find((p) => p.path === path) ?? null
}

export function flattenResourceListEntries(list: ResourceList): ResourceEntry[] {
  return [...list.artifacts, ...list.uploads, ...list.skills_draft]
}

export function resolveResourceEntryWithPending(
  selectedPath: string | null,
  mergedResources: ResourceList,
  pendingList: PendingResource[]
): ResourceEntry | null {
  if (!selectedPath) return null
  const fromMerged = findEntryByPath(
    flattenResourceListEntries(mergedResources),
    selectedPath
  )
  if (fromMerged) return fromMerged
  const pending = findPendingByPath(pendingList, selectedPath)
  return pending ? pendingToResourceEntry(pending) : null
}

export function collectAllResourcePaths(list: ResourceList): string[] {
  const paths: string[] = []
  function visit(entries: ResourceEntry[]) {
    for (const entry of entries) {
      paths.push(entry.path)
      if (entry.children) visit(entry.children)
    }
  }
  visit(list.artifacts)
  visit(list.uploads)
  visit(list.skills_draft)
  return paths
}
