import { useQuery } from "@tanstack/react-query"

import { fetchSkillList } from "@/api/employee"
import { fetchLocalSkillDetail } from "@/api/skill"
import { chatKeys } from "@/lib/query-keys/chat"
import { useOfflineMode } from "@/lib/runtime/runtime-provider"

export function useSkillListQuery() {
  return useQuery({
    queryKey: chatKeys.skills(),
    queryFn: ({ signal }) => fetchSkillList({ signal }),
    staleTime: 0,
  })
}

/** 技能管理页：本地/内置列表，不等待远程平台 */
export function useLocalSkillListQuery() {
  return useQuery({
    queryKey: chatKeys.skillsPickerLocal(),
    queryFn: ({ signal }) => fetchSkillList({ signal, localOnly: true }),
    staleTime: 0,
  })
}

/** 技能管理页：企业远程平台技能（离线时不请求） */
export function useRemotePlatformSkillListQuery() {
  const offline = useOfflineMode()
  return useQuery({
    queryKey: [...chatKeys.skills(), "remote-platform"] as const,
    queryFn: async ({ signal }) => {
      const all = await fetchSkillList({ signal })
      return all.filter((item) => item.source === "remote")
    },
    enabled: !offline,
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
