export const chatKeys = {
  all: ["chat"] as const,
  contacts: () => [...chatKeys.all, "contacts"] as const,
  conversations: (contactId: string) =>
    [...chatKeys.all, "conversations", contactId] as const,
  messages: (conversationId: string) =>
    [...chatKeys.all, "messages", conversationId] as const,
  employee: (id: string) => [...chatKeys.all, "employee", id] as const,
  group: (id: string) => [...chatKeys.all, "group", id] as const,
  shiftCalendar: (year: number, month: number) =>
    [...chatKeys.all, "shift-calendar", year, month] as const,
  resources: (conversationId: string) =>
    [...chatKeys.all, "resources", conversationId] as const,
  resourceContent: (conversationId: string, path: string) =>
    [...chatKeys.all, "resource-content", conversationId, path] as const,
}
