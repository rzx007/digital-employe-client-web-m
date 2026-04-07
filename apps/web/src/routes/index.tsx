import { createFileRoute } from "@tanstack/react-router"

import { ChatLayout } from "@/components/chat/chat-layout"

export const Route = createFileRoute("/")({
  component: ChatPage,
})

function ChatPage() {
  return (
    <div className="h-svh overflow-hidden">
      <ChatLayout />
    </div>
  )
}
