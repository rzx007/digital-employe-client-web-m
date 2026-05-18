import { useQuery } from "@tanstack/react-query"

import { fetchSkillList } from "@/api/employee"
import { fetchLocalSkillDetail } from "@/api/skill"
import { chatKeys } from "@/lib/query-keys/chat"

export function useSkillListQuery() {
  return useQuery({
    queryKey: chatKeys.skills(),
    queryFn: ({ signal }) => fetchSkillList({ signal }),
    staleTime: 0,
  })
}

/** 招聘 / 员工编辑技能选择器：仅本地 + 内置，不请求远程列表 */
export function useEmployeePickerSkillsQuery() {
  return useQuery({
    queryKey: chatKeys.skillsPickerLocal(),
    queryFn: ({ signal }) => fetchSkillList({ signal, localOnly: true }),
    staleTime: 0,
    select: (data) => data.filter((s) => s.source !== "remote"),
  })
}

export function useLocalSkillDetailQuery(skillName: string | null) {
  return useQuery({
    queryKey: chatKeys.localSkillDetail(skillName ?? ""),
    queryFn: ({ signal }) => fetchLocalSkillDetail(skillName!, { signal }),
    enabled: Boolean(skillName),
  })
}
