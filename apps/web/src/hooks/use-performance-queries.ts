import { useQuery } from "@tanstack/react-query"
import { fetchMonthlyBalance } from "@/api/performance"
import { useCapability } from "@/lib/runtime/runtime-provider"

export function useCurrentMonthPerformance() {
  const canPerformance = useCapability("remote_performance")
  return useQuery({
    queryKey: ["performance", "monthly-balance"],
    queryFn: async ({ signal }) => {
      const res = await fetchMonthlyBalance({ signal })
      return res.data ?? null
    },
    staleTime: 5 * 60_000,
    enabled: canPerformance,
  })
}
