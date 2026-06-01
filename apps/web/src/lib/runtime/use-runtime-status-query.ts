import { useQuery } from "@tanstack/react-query"
import { fetchRuntimeConfig } from "@/api/system"

export function useRuntimeStatusQuery() {
  return useQuery({
    queryKey: ["system", "runtime"],
    queryFn: fetchRuntimeConfig,
    staleTime: 5_000,
    refetchInterval: (query) => {
      const serial = query.state.data?.data?.agent_runtime?.serial_mode
      return serial ? 4_000 : 15_000
    },
  })
}
