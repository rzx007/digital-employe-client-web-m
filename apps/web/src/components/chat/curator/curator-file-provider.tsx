"use client"

import { useMemo, type ReactNode } from "react"
import {
  CuratorFileContext,
  type CuratorFileContextValue,
} from "./curator-file-context"

export function CuratorFileProvider({
  value,
  children,
}: {
  value: CuratorFileContextValue
  children: ReactNode
}) {
  const memoValue = useMemo(() => value, [value])

  return (
    <CuratorFileContext.Provider value={memoValue}>
      {children}
    </CuratorFileContext.Provider>
  )
}
