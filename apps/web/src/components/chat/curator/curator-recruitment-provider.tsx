"use client"

import { useMemo, type ReactNode } from "react"
import {
  CuratorRecruitmentContext,
  type CuratorRecruitmentContextValue,
} from "./curator-recruitment-context"

export function CuratorRecruitmentProvider({
  value,
  children,
}: {
  value: CuratorRecruitmentContextValue
  children: ReactNode
}) {
  const memoValue = useMemo(() => value, [value])

  return (
    <CuratorRecruitmentContext.Provider value={memoValue}>
      {children}
    </CuratorRecruitmentContext.Provider>
  )
}
