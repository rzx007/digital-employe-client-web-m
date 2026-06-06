import type { Contact } from "@/types/chat"

/**
 * 联系人唯一标识带 type 前缀（curator/employee/group），
 * 避免不同类型主键自增 id 重合（如 group.id===3 与 employee.id===3）
 * 导致点群聊却跳到同 id 员工的串号问题。
 */
export function getContactId(contact: Contact | undefined | null): string | null {
  if (!contact) return null
  if (contact.type === "curator") {
    return contact.curator?.id ? `curator:${contact.curator.id}` : null
  }
  if (contact.type === "employee") {
    return contact.employee?.id ? `employee:${contact.employee.id}` : null
  }
  return contact.group?.id ? `group:${contact.group.id}` : null
}

/**
 * 按联系人标识查找。优先匹配带前缀的 id（curator:/employee:/group:）；
 * 若传入的是裸 id（历史/最近会话层用的纯数字），可选 typeHint 消除
 * 群与员工同 id 的歧义；无 hint 时回退到任意类型匹配（旧行为）。
 */
export function findContactInList(
  contacts: readonly Contact[],
  id: string,
  typeHint?: Contact["type"]
): Contact | undefined {
  // 带前缀：精确匹配
  if (id.includes(":")) {
    return contacts.find((contact) => getContactId(contact) === id)
  }
  // 裸 id + 类型提示：按类型精确匹配，避免群/员工串号
  if (typeHint) {
    return contacts.find((contact) => {
      if (contact.type !== typeHint) return false
      if (contact.type === "curator") return contact.curator?.id === id
      if (contact.type === "employee") return contact.employee?.id === id
      return contact.group?.id === id
    })
  }
  // 裸 id 无提示：旧行为，任意类型匹配（curator 优先于 employee 优先于 group 按列表顺序）
  return contacts.find((contact) => {
    if (contact.type === "curator") return contact.curator?.id === id
    if (contact.type === "employee") return contact.employee?.id === id
    return contact.group?.id === id
  })
}

/** 比较 store 前缀 id（employee:1）与最近会话裸 id（1）是否同一联系人 */
export function contactIdsMatch(
  a: string | null | undefined,
  b: string | null | undefined,
  contacts: readonly Contact[],
  bTypeHint?: Contact["type"]
): boolean {
  if (!a || !b) return false
  if (a === b) return true

  const resolve = (id: string, hint?: Contact["type"]) => {
    if (id.includes(":")) return id
    const contact = findContactInList(contacts, id, hint)
    return getContactId(contact) ?? id
  }

  return resolve(a) === resolve(b, bTypeHint)
}
