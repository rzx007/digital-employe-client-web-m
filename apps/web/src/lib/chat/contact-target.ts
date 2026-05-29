import type { ChatTargetType } from "@/api/types"
import type { Contact } from "@/types/chat"

export function mapContactToTarget(contact: Contact): {
  target_type: ChatTargetType
  target_id: number
} | null {
  if (contact.type === "curator") {
    const curatorId = Number(contact.curator?.id)
    return Number.isNaN(curatorId)
      ? null
      : { target_type: "curator", target_id: curatorId }
  }
  if (contact.type === "employee") {
    const eid = Number(contact.employee?.id)
    return Number.isNaN(eid) ? null : { target_type: "employee", target_id: eid }
  }
  if (contact.type === "group") {
    const gid = Number(contact.group?.id)
    return Number.isNaN(gid) ? null : { target_type: "group", target_id: gid }
  }
  return null
}
