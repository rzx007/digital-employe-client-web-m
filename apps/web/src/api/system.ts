import { request } from "@/lib/request"
import type { RuntimeConfigResponse } from "@/lib/runtime/runtime-types"

export async function fetchRuntimeConfig() {
  return request<RuntimeConfigResponse>("/system/runtime", {
    method: "GET",
  })
}

export type ForceClearAllResult = {
  cleared_count: number
  cleared_conversation_ids: number[]
  spared_count?: number
  spared_conversation_ids?: number[]
  drained_queue: number
}

/** 一键清理所有在飞/排队（含僵尸）的流，立即腾空槽位（不重启后端）。 */
export async function forceClearAllStreams() {
  return request<ForceClearAllResult>("/system/streams/force-clear-all", {
    method: "POST",
  })
}
