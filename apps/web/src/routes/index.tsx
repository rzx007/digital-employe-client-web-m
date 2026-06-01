import { createFileRoute } from "@tanstack/react-router"

import { ChatLayout } from "@/components/chat/shell/chat-layout"
import { AppTitlebar } from "@/components/chat/shell/app-titlebar"

export const Route = createFileRoute("/")({
  component: ChatPage,
})

function ChatPage() {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <AppTitlebar />
      <ChatLayout />
    </div>
  )
}
