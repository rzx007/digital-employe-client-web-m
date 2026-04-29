import { useQuery } from "@tanstack/react-query"

import { fetchSkillList } from "@/api/employee"
import { fetchLocalSkillDetail } from "@/api/skill"
import { chatKeys } from "@/lib/query-keys/chat"

export function useSkillListQuery() {
  return useQuery({
    queryKey: chatKeys.skills(),
    queryFn: fetchSkillList,
    staleTime: 0,
  })
}

export function useLocalSkillDetailQuery(skillName: string | null) {
  return useQuery({
    queryKey: chatKeys.localSkillDetail(skillName ?? ""),
    queryFn: () => fetchLocalSkillDetail(skillName!),
    enabled: Boolean(skillName),
  })
}
