import * as React from "react"

import { Sheet, SheetContent } from "@workspace/ui/components/sheet"
import { cn } from "@workspace/ui/lib/utils"
import { ArtifactPanel } from "@/components/artifact"
import { MonitorPanel } from "@/components/schedule-monitor"
import { useIsMobile } from "@/hooks/use-mobile"
import { useArtifactStore } from "@/stores/artifact-store"
import { useMonitorStore } from "@/stores/monitor-store"
import { useChatStore } from "@/stores/chat-store"
import { AppToolbar } from "./app-toolbar"
import { CalendarPlaceholder } from "./calendar-placeholder"
import { ChatView } from "./chat-view"
import { ContactDetailPanel } from "./contact-detail-panel"
import { ContactsPanel } from "./contacts-panel"
import { ConversationList } from "./conversation-list"
import { RecentConversations } from "./recent-conversations"

export function ChatLayout({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const isMobile = useIsMobile()
  const activeTab = useChatStore((s) => s.activeTab)

  const [showConversations, setShowConversations] = React.useState(false)

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

  const handleNewConversation = () => {
    const { setDraftConversation, setSelectedConversationId } =
      useChatStore.getState()
    setDraftConversation(true)
    setSelectedConversationId(null)
  }

  const handleOpenConversations = () => {
    setShowConversations(true)
  }

  const handleOpenContacts = () => {
    useChatStore.getState().setActiveTab("contacts")
  }

  const showMonitorSheet = isMonitorOpen && activeTab === "chat"

  return (
    <div className={cn("relative flex h-full", className)} {...props}>
      {!isMobile && <AppToolbar />}

      {!isMobile && (
        <div className="hidden w-64 shrink-0 md:flex md:flex-col">
          {activeTab === "chat" && (
            <RecentConversations className="h-full w-full" />
          )}
          {activeTab === "contacts" && (
            <ContactsPanel className="h-full w-full" />
          )}
          {activeTab === "calendar" && (
            <CalendarPlaceholder className="h-full w-full" />
          )}
        </div>
      )}

      <div className="flex min-w-0 flex-1">
        {activeTab === "chat" && (
          <ChatView
            onOpenContacts={handleOpenContacts}
            onOpenConversations={handleOpenConversations}
            onNewConversation={handleNewConversation}
            className="min-w-0 flex-1"
          />
        )}

        {activeTab === "contacts" && (
          <ContactDetailPanel className="min-w-0 flex-1" />
        )}

        {activeTab === "calendar" && (
          <CalendarPlaceholder variant="content" className="min-w-0 flex-1" />
        )}

        {isPanelOpen &&
          activeArtifact &&
          !isFullscreen &&
          !isMobile &&
          activeTab === "chat" && (
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
      </div>

      {/* Conversation history Sheet */}
      <Sheet open={showConversations} onOpenChange={setShowConversations}>
        <SheetContent side="right" className="w-[300px] p-0">
          <ConversationList
            className="h-full w-full border-r-0"
            onSelectConversation={() => setShowConversations(false)}
          />
        </SheetContent>
      </Sheet>

      {/* MonitorPanel as Sheet in chat mode */}
      <Sheet
        open={showMonitorSheet}
        onOpenChange={(open) => {
          if (!open) closeMonitor()
        }}
      >
        <SheetContent side="right" className="w-[520px] p-0 sm:w-[600px]">
          <MonitorPanel
            isOpen={true}
            isFullscreen={false}
            onClose={closeMonitor}
            onToggleFullscreen={() => {}}
            className="h-full w-full rounded-none border-0 shadow-none"
          />
        </SheetContent>
      </Sheet>

      {/* Mobile Sheet for contacts */}
      {isMobile && (
        <Sheet
          open={isMobile && activeTab === "contacts"}
          onOpenChange={(open) => {
            if (!open) useChatStore.getState().setActiveTab("chat")
          }}
        >
          <SheetContent side="left" className="w-64 p-0">
            <ContactsPanel className="h-full w-full border-r-0" />
          </SheetContent>
        </Sheet>
      )}

      {/* Artifact fullscreen */}
      {isPanelOpen &&
        activeArtifact &&
        (isFullscreen || isMobile) &&
        activeTab === "chat" && (
          <ArtifactPanel
            artifact={activeArtifact}
            isOpen={isPanelOpen}
            isFullscreen={isFullscreen}
            onClose={closeArtifact}
            onToggleFullscreen={toggleFullscreen}
          />
        )}

      {/* Monitor fullscreen (non-chat tab) */}
      {isMonitorOpen && isMonitorFullscreen && activeTab !== "chat" && (
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
