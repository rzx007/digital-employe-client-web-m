import { useQuery } from "@tanstack/react-query"
import { fetchMonthlyBalance } from "@/api/performance"

export function useCurrentMonthPerformance() {
  return useQuery({
    queryKey: ["performance", "monthly-balance"],
    queryFn: async () => {
      const res = await fetchMonthlyBalance()
      return res.data ?? null
    },
    staleTime: 5 * 60_000,
  })
}
