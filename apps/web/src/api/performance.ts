import { request } from "@/lib/request"
import type { ApiResponse } from "./types"

export interface MonthlyBalance {
  name: string
  staff_no: string
  month: string
  balance: number
  gdp: number
  rank: number
}

export async function fetchMonthlyBalance(opts?: { signal?: AbortSignal }) {
  return request<ApiResponse<MonthlyBalance>>("/performance/monthly-balance", {
    ...(opts?.signal ? { signal: opts.signal } : {}),
  })
}
