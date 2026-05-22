import { createContext } from "react"

export type CuratorFileContextValue = {
  conversationId: string | number | null
  onOpenFile: (path: string) => void
}

export const CuratorFileContext =
  createContext<CuratorFileContextValue | null>(null)
