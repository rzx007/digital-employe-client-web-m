import type { Contact } from "@/types/chat"

export function findContactInList(
  contacts: readonly Contact[],
  id: string
): Contact | undefined {
  return contacts.find((contact) => {
    if (contact.type === "curator") {
      return contact.curator?.id === id
    }
    if (contact.type === "employee") {
      return contact.employee?.id === id
    }
    return contact.group?.id === id
  })
}
