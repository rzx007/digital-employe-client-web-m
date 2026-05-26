import { request } from "@/lib/request"
import type { RuntimeConfigResponse } from "@/lib/runtime/runtime-types"

export async function fetchRuntimeConfig() {
  return request<RuntimeConfigResponse>("/system/runtime", {
    method: "GET",
  })
}
