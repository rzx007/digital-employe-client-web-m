import { useQuery } from "@tanstack/react-query"
import { fetchActivationStatus, fetchDeviceCode } from "@/api/activation"
import { useRuntimeConfig } from "@/lib/runtime/runtime-provider"

export function useActivationRequired(): boolean {
  const config = useRuntimeConfig()
  return config.capabilities.activation_enforced ?? false
}

export function useDeviceCode() {
  return useQuery({
    queryKey: ["activation", "device"],
    queryFn: fetchDeviceCode,
    staleTime: Infinity,
  })
}

export function useActivationStatus(enabled = true) {
  return useQuery({
    queryKey: ["activation", "status"],
    queryFn: fetchActivationStatus,
    enabled,
  })
}
