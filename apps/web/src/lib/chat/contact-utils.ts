import type { Contact } from "@/types/chat"

export function getContactId(contact: Contact | undefined | null): string | null {
  if (!contact) return null
  if (contact.type === "curator") return contact.curator?.id ?? null
  if (contact.type === "employee") return contact.employee?.id ?? null
  return contact.group?.id ?? null
}

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
