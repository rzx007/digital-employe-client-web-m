import { createContext } from "react"
import type { RecruitmentCandidateItem } from "@/lib/chat/recruitment-tool-payload"

export type CuratorRecruitmentContextValue = {
  onHire: (candidate: RecruitmentCandidateItem) => void
  onHireAll: (candidates: RecruitmentCandidateItem[]) => void
  hireDisabled: boolean
}

export const CuratorRecruitmentContext =
  createContext<CuratorRecruitmentContextValue | null>(null)
