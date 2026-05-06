import { useQuery } from "@tanstack/react-query"
import { fetchCurrentMonthPerformance } from "@/api/performance"

export function useCurrentMonthPerformance() {
  return useQuery({
    queryKey: ["performance", "current-month"],
    queryFn: async () => {
      const res = await fetchCurrentMonthPerformance()
      return res.data?.[0] ?? null
    },
    staleTime: 5 * 60_000,
  })
}
