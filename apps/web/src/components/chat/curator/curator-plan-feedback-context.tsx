"use client"

import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from "react"

export interface CuratorPlanFeedbackContextValue {
  sendPlanFeedback: (text: string) => Promise<void>
}

const CuratorPlanFeedbackContext =
  createContext<CuratorPlanFeedbackContextValue | null>(null)

export function CuratorPlanFeedbackProvider({
  value,
  children,
}: {
  value: CuratorPlanFeedbackContextValue
  children: ReactNode
}) {
  const memoValue = useMemo(() => value, [value])

  return (
    <CuratorPlanFeedbackContext.Provider value={memoValue}>
      {children}
    </CuratorPlanFeedbackContext.Provider>
  )
}

export function useCuratorPlanFeedback(): CuratorPlanFeedbackContextValue | null {
  return useContext(CuratorPlanFeedbackContext)
}
