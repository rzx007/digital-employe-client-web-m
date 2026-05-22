"use client"

import { useContext } from "react"
import {
  CuratorRecruitmentContext,
  type CuratorRecruitmentContextValue,
} from "./curator-recruitment-context"

export function useCuratorRecruitment(): CuratorRecruitmentContextValue | null {
  return useContext(CuratorRecruitmentContext)
}
