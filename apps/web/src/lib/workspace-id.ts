import { useAuthStore } from "@/stores/auth-store"

export const DEFAULT_WORKSPACE_ID = 1

/** 与 auth store / localStorage 对齐的当前 workspace id（API 与 queryKey 共用） */
export function getActiveWorkspaceId(): number {
  const fromStore = useAuthStore.getState().workspaceId
  if (fromStore != null && !Number.isNaN(fromStore)) {
    return fromStore
  }

  if (typeof localStorage !== "undefined") {
    const cached = localStorage.getItem("workspaceId")
    if (cached) {
      const parsed = Number(cached)
      if (!Number.isNaN(parsed)) return parsed
    }
  }

  return DEFAULT_WORKSPACE_ID
}
