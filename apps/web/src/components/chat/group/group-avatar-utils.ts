import type { DagNode, GroupRoomMember } from "@/api/group-room"
import { CURATOR_ASSISTANT_AVATAR_URL_1 } from "@/lib/avatar"
import type { AIEmployee } from "@/types/chat"

export function buildParticipantById(
  participants?: AIEmployee[]
): Map<string, AIEmployee> {
  const map = new Map<string, AIEmployee>()
  for (const participant of participants ?? []) {
    map.set(participant.id, participant)
  }
  return map
}

function resolveLeaderAvatar(): {
  name: string
  avatar: string
  status: AIEmployee["status"]
} {
  return { name: "组长", avatar: CURATOR_ASSISTANT_AVATAR_URL_1, status: "online" }
}

function resolveEmployeeAvatar(
  employeeId: number | null | undefined,
  displayName: string | null | undefined,
  participantById: Map<string, AIEmployee>
): {
  name: string
  avatar?: string
  status?: AIEmployee["status"]
} {
  const id = employeeId != null ? String(employeeId) : null
  const participant = id ? participantById.get(id) : undefined
  const name =
    displayName?.trim() ||
    participant?.name ||
    (id ? `员工#${id}` : "员工")

  return {
    name,
    avatar: participant?.avatar,
    status: participant?.status,
  }
}

export function resolveGroupRoomMemberAvatar(
  member: GroupRoomMember,
  participantById: Map<string, AIEmployee>
): {
  name: string
  avatar?: string
  status?: AIEmployee["status"]
} {
  if (member.role_in_room === "leader") {
    return resolveLeaderAvatar()
  }
  return resolveEmployeeAvatar(
    member.employee_id,
    member.employee_name,
    participantById
  )
}

export function resolveDagNodeAvatar(
  node: DagNode,
  participantById: Map<string, AIEmployee>
): {
  name: string
  avatar?: string
  status?: AIEmployee["status"]
} {
  if (node.type === "leader") {
    return resolveLeaderAvatar()
  }
  if (node.type === "worker") {
    return resolveEmployeeAvatar(node.employee_id, node.name, participantById)
  }
  return { name: node.name?.trim() || "你" }
}
