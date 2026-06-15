import { useQuery } from "@tanstack/react-query"
import { fetchEmployeeGrowthBrain } from "@/api/employee"

export function useEmployeeGrowthBrain(
  employeeId: string | number | null
) {
  return useQuery({
    queryKey: ["employee-growth-brain", employeeId],
    queryFn: async ({ signal }) =>
      (await fetchEmployeeGrowthBrain(employeeId!, { signal })).data,
    enabled: Boolean(employeeId),
    staleTime: 60_000,
  })
}
