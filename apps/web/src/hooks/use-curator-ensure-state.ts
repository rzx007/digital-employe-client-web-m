import { useSyncExternalStore } from "react"

import {
  getCuratorEnsureSnapshot,
  subscribeCuratorEnsure,
} from "@/lib/chat/curator-conversation-actions"

export function useCuratorEnsureState() {
  return useSyncExternalStore(
    subscribeCuratorEnsure,
    getCuratorEnsureSnapshot,
    getCuratorEnsureSnapshot
  )
}
