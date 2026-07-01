import { request } from "@/lib/request"
import type { ActivationRuntime } from "@/lib/runtime/runtime-types"

interface ResponseBase<T> {
  code: number
  msg: string
  data: T
}

export async function fetchDeviceCode() {
  return request<ResponseBase<{ device_code: string }>>("/activation/device", {
    method: "GET",
  })
}

export async function fetchActivationStatus() {
  return request<ResponseBase<ActivationRuntime>>("/activation/status", {
    method: "GET",
  })
}

export async function activateLicense(licenseCode: string) {
  return request<ResponseBase<ActivationRuntime>>("/activation/activate", {
    method: "POST",
    body: { license_code: licenseCode },
  })
}
