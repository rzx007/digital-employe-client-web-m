import * as React from "react"
import { useShallow } from "zustand/react/shallow"

import { Sheet, SheetContent } from "@workspace/ui/components/sheet"
import { cn } from "@workspace/ui/lib/utils"
import { ArtifactPanel } from "@/components/artifact"
import { MonitorPanel } from "@/components/schedule-monitor"
import { useIsMobile } from "@/hooks/use-mobile"
import { useArtifactStore } from "@/stores/artifact-store"
import { useMonitorStore } from "@/stores/monitor-store"
import { useChatStore } from "@/stores/chat-store"
import { ContactsSidebar } from "./contacts-sidebar"
import { ConversationList } from "./conversation-list"
import { ChatView } from "./chat-view"

export function ChatLayout({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const [showContacts, setShowContacts] = React.useState(false)
  const [showConversations, setShowConversations] = React.useState(false)
  const isMobile = useIsMobile()
  const { setDraftConversation, setSelectedConversationId } = useChatStore(
    useShallow((state) => ({
      setDraftConversation: state.setDraftConversation,
      setSelectedConversationId: state.setSelectedConversationId,
    }))
  )

  const handleNewConversation = () => {
    setDraftConversation(true)
    setSelectedConversationId(null)
  }
  const {
    activeArtifactId,
    artifacts,
    closeArtifact,
    isFullscreen,
    isPanelOpen,
    setFullscreen,
    toggleFullscreen,
  } = useArtifactStore()

  const {
    isOpen: isMonitorOpen,
    isFullscreen: isMonitorFullscreen,
    closeMonitor,
    toggleFullscreen: toggleMonitorFullscreen,
    setFullscreen: setMonitorFullscreen,
  } = useMonitorStore()

  const activeArtifact = activeArtifactId
    ? (artifacts.get(activeArtifactId) ?? null)
    : null

  React.useEffect(() => {
    if (isMobile && isPanelOpen && activeArtifact) {
      setFullscreen(true)
    }
  }, [activeArtifact, isMobile, isPanelOpen, setFullscreen])

  React.useEffect(() => {
    if (isMobile && isMonitorOpen) {
      setMonitorFullscreen(true)
    }
  }, [isMobile, isMonitorOpen, setMonitorFullscreen])
  return (
    <div className={cn("relative flex h-full", className)} {...props}>
      <ContactsSidebar className="hidden md:flex" />

      <div className="flex min-w-0 flex-1">
        <ChatView
          onOpenContacts={() => setShowContacts(true)}
          onOpenConversations={() => setShowConversations(true)}
          onNewConversation={handleNewConversation}
          className="min-w-0 flex-1"
        />

        {isPanelOpen && activeArtifact && !isFullscreen && !isMobile && (
          <div className="hidden w-[600px] border-l bg-muted/20 p-3 md:block">
            <ArtifactPanel
              artifact={activeArtifact}
              isOpen={isPanelOpen}
              isFullscreen={false}
              onClose={closeArtifact}
              onToggleFullscreen={toggleFullscreen}
              className="h-full rounded-xl"
            />
          </div>
        )}
        {isMonitorOpen && !isMonitorFullscreen && !isMobile && (
          <div className="hidden w-[380px] border-l bg-muted/20 p-2 transition-all duration-100 sm:block lg:p-3 2xl:w-[520px]">
            <MonitorPanel
              isOpen={isMonitorOpen}
              isFullscreen={false}
              onClose={closeMonitor}
              onToggleFullscreen={toggleMonitorFullscreen}
              className="h-full rounded-xl"
            />
          </div>
        )}
      </div>

      <Sheet open={showContacts} onOpenChange={setShowContacts}>
        <SheetContent side="left" className="w-64 p-0 md:hidden">
          <ContactsSidebar className="h-full w-full border-r-0" />
        </SheetContent>
      </Sheet>

      <Sheet open={showConversations} onOpenChange={setShowConversations}>
        <SheetContent side="right" className="w-[300px] p-0">
          <ConversationList
            className="h-full w-full border-r-0"
            onSelectConversation={() => setShowConversations(false)}
          />
        </SheetContent>
      </Sheet>

      {isPanelOpen && activeArtifact && (isFullscreen || isMobile) && (
        <ArtifactPanel
          artifact={activeArtifact}
          isOpen={isPanelOpen}
          isFullscreen={isFullscreen}
          onClose={closeArtifact}
          onToggleFullscreen={toggleFullscreen}
        />
      )}
      {isMonitorOpen && (isMonitorFullscreen || isMobile) && (
        <MonitorPanel
          isOpen={isMonitorOpen}
          isFullscreen={isMonitorFullscreen}
          onClose={closeMonitor}
          onToggleFullscreen={toggleMonitorFullscreen}
        />
      )}
    </div>
  )
}
