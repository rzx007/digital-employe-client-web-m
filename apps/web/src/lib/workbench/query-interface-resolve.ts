import type { QueryInterface } from "@/types/workbench"

export function extractBaseUrlFromPath(path: string): string {
  try {
    const url = new URL(path)
    return url.origin
  } catch {
    return ""
  }
}

function extractPath(path: string): string {
  try {
    const url = new URL(path)
    return url.pathname + url.search
  } catch {
    return path
  }
}

/**
 * Normalize baseUrl + path the same way as when persisting a block (see add-block-dialog handleAdd).
 * Ensures preview and workbench fetch the same URL.
 */
export function normalizeQueryInterfaceForRequest(
  iface: QueryInterface,
  userBaseUrlOverride?: string
): QueryInterface {
  const trimmed = userBaseUrlOverride?.trim()
  let baseUrl = iface.baseUrl || ""
  let path = iface.path

  if (trimmed) {
    baseUrl = trimmed
    if (path.startsWith("http")) {
      path = extractPath(path)
    }
  } else if (path.startsWith("http")) {
    baseUrl = extractBaseUrlFromPath(path)
    path = extractPath(path)
  }

  return {
    ...iface,
    baseUrl,
    path,
  }
}

/**
 * Detect which key/path holds the array of records (aligned with add-block-dialog).
 */
export function detectResponseFormat(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return undefined

  const dataObj = data as Record<string, unknown>
  const dataKeys = [
    "data",
    "list",
    "result",
    "results",
    "records",
    "items",
    "rows",
    "array",
    "values",
  ]

  for (const key of dataKeys) {
    if (dataObj[key] && Array.isArray(dataObj[key])) {
      return key
    }
  }

  for (const outer of ["data", "response", "result"]) {
    if (dataObj[outer] && typeof dataObj[outer] === "object") {
      const nested = dataObj[outer] as Record<string, unknown>
      for (const inner of dataKeys) {
        if (nested[inner] && Array.isArray(nested[inner])) {
          return `${outer}.${inner}`
        }
      }
    }
  }

  return undefined
}
