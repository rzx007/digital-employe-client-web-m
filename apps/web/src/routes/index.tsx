import { createFileRoute } from "@tanstack/react-router"

import { ChatLayout } from "@/components/chat/chat-layout"
import { AppTitlebar } from "@/components/chat/app-titlebar"

export const Route = createFileRoute("/")({
  component: ChatPage,
})

function ChatPage() {
  return (
    <div className="flex h-svh flex-col overflow-hidden">
      <AppTitlebar />
      <ChatLayout />
    </div>
  )
}
