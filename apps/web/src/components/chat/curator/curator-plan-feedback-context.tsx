"use client"

import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from "react"

import type { ToolUiActionOutbound } from "@/lib/chat/tool-ui-action"

export interface CuratorPlanFeedbackContextValue {
  sendPlanFeedback: (payload: ToolUiActionOutbound) => Promise<void>
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
