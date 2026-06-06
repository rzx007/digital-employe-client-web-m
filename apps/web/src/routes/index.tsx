import { createFileRoute } from "@tanstack/react-router"

import { AppStatusBar } from "@/components/app-status-bar"
import { ChatLayout } from "@/components/chat/shell/chat-layout"
import { AppTitlebar } from "@/components/chat/shell/app-titlebar"

export const Route = createFileRoute("/")({
  component: ChatPage,
})

function ChatPage() {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <AppTitlebar />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <ChatLayout />
      </div>
      <AppStatusBar />
    </div>
  )
}
