import type { ResourceEntry, ResourceList } from "@/api/types"
import type { PendingResource } from "@/stores/artifact-store"

export type ResourceBucket = "artifacts" | "skills_draft"

export function getResourceBucket(path: string): ResourceBucket | null {
  if (path.startsWith("/artifacts/")) return "artifacts"
  if (path.startsWith("/skills-draft/")) return "skills_draft"
  return null
}

function getBasename(path: string) {
  const segments = path.split("/").filter(Boolean)
  return segments.at(-1) ?? path
}

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
  if (path.startsWith("/skills-draft/")) {
    return "skill-draft"
  }
  if (["pdf", "doc", "docx", "ppt", "pptx"].includes(ext)) {
    return "document"
  }
  return "text"
}

export function pendingToResourceEntry(pending: PendingResource): ResourceEntry {
  return {
    name: getBasename(pending.path),
    path: pending.path,
    entry_type: "file",
    artifact_type: inferArtifactType(pending.path),
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
  fileEntry: ResourceEntry
): ResourceEntry[] {
  const path = fileEntry.path
  if (pathExistsInTree(entries, path)) {
    return entries
  }

  const segments = path.split("/").filter(Boolean)
  if (segments.length === 0) return entries

  const dirSegments = segments.slice(0, -1)

  function insertAt(
    current: ResourceEntry[],
    depth: number
  ): ResourceEntry[] {
    if (depth >= dirSegments.length) {
      return [...current, fileEntry]
    }

    const dirName = dirSegments[depth]!
    const dirPath = `/${dirSegments.slice(0, depth + 1).join("/")}`
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
  pendingList: PendingResource[]
): ResourceEntry[] {
  let merged = entries
  for (const pending of pendingList) {
    if (pathExistsInTree(merged, pending.path)) continue
    merged = insertFileEntry(merged, pendingToResourceEntry(pending))
  }
  return merged
}

export function mergePendingIntoResourceList(
  list: ResourceList,
  pendingList: PendingResource[]
): ResourceList {
  const artifactsPending = pendingList.filter(
    (p) => getResourceBucket(p.path) === "artifacts"
  )
  const skillsDraftPending = pendingList.filter(
    (p) => getResourceBucket(p.path) === "skills_draft"
  )

  return {
    artifacts: mergePendingIntoEntries(list.artifacts, artifactsPending),
    uploads: list.uploads,
    skills_draft: mergePendingIntoEntries(
      list.skills_draft,
      skillsDraftPending
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
