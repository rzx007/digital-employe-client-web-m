export const chatKeys = {
  all: ["chat"] as const,
  contacts: () => [...chatKeys.all, "contacts"] as const,
  conversations: (contactId: string) =>
    [...chatKeys.all, "conversations", contactId] as const,
  messages: (conversationId: string) =>
    [...chatKeys.all, "messages", conversationId] as const,
  employee: (id: string) => [...chatKeys.all, "employee", id] as const,
  group: (id: string) => [...chatKeys.all, "group", id] as const,
}
