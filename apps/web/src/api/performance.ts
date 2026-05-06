import { request } from "@/lib/request"
import type { ApiResponse } from "./types"

export interface PerformanceRecord {
  id: number
  assessment_period: string
  username: string
  work_no: string
  department: string
  position_title: string
  monthly_ac_total: number
  monthly_ev_total: number
  monthly_work_deviation: number
  ac_actual_base_value: number
  workday_base_deviation: number
  assessment_department: string
  created_at: string
  updated_at: string
}

export async function fetchCurrentMonthPerformance() {
  return request<ApiResponse<PerformanceRecord[]>>(
    "/performance-records/current-month"
  )
}
