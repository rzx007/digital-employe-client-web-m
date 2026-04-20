import * as React from "react"
import { toast } from "sonner"

import { Sheet, SheetContent } from "@workspace/ui/components/sheet"
import { cn } from "@workspace/ui/lib/utils"
import { useQueryClient } from "@tanstack/react-query"
import { ArtifactPanel } from "@/components/artifact"
import { MonitorPanel } from "@/components/schedule-monitor"
import { useIsMobile } from "@/hooks/use-mobile"
import { useContactsQuery } from "@/hooks/use-chat-queries"
import { chatKeys } from "@/lib/query-keys/chat"
import { useArtifactStore } from "@/stores/artifact-store"
import { useMonitorStore } from "@/stores/monitor-store"
import { useChatStore } from "@/stores/chat-store"
import { useOnboardingStore } from "@/stores/onboarding-store"
import { PRIMARY_CURATOR } from "@/lib/mock-data/ai-employees"
import { WelcomeDialog, UserTour } from "@/components/onboarding"
import { AppToolbar } from "./app-toolbar"
import { CalendarPlaceholder } from "./calendar-placeholder"
import { ChatView } from "./chat-view"
import { ContactDetailPanel } from "./contact-detail-panel"
import { ContactsPanel } from "./contacts-panel"
import { ConversationList } from "./conversation-list"
import { MobileTabBar } from "./mobile-tab-bar"
import { RecentConversations } from "./recent-conversations"
import { WorkbenchView } from "./workbench-view"

const CURATOR_CONTACT = { type: "curator" as const, curator: PRIMARY_CURATOR }

export function ChatLayout({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const isMobile = useIsMobile()
  const activeTab = useChatStore((s) => s.activeTab)
  const setContacts = useChatStore((s) => s.setContacts)
  const showWelcome = useOnboardingStore((s) => s.showWelcome)
  const onboardingCompleted = useOnboardingStore((s) => s.onboardingCompleted)
  const initialized = useOnboardingStore((s) => s.initialized)
  const initOnboarding = useOnboardingStore((s) => s.initOnboarding)

  const { data: apiContacts, isError: contactsError } = useContactsQuery()

  const hasContactsErrorToastRef = React.useRef(false)

  React.useEffect(() => {
    initOnboarding()
  }, [initOnboarding])

  React.useEffect(() => {
    if (initialized && !onboardingCompleted) {
      const timer = setTimeout(() => showWelcome(), 1500)
      return () => clearTimeout(timer)
    }
  }, [initialized, onboardingCompleted, showWelcome])

  React.useEffect(() => {
    if (apiContacts) {
      setContacts([CURATOR_CONTACT, ...apiContacts])
    }
  }, [apiContacts, setContacts])

  React.useEffect(() => {
    if (!contactsError) {
      hasContactsErrorToastRef.current = false
      return
    }
    const { contacts, selectedContactId } = useChatStore.getState()
    const hasCurator = contacts.some((c) => c.type === "curator")
    if (!hasCurator) {
      useChatStore.getState().setContacts([CURATOR_CONTACT])
    }
    if (selectedContactId !== PRIMARY_CURATOR.id) {
      if (!hasContactsErrorToastRef.current) {
        hasContactsErrorToastRef.current = true
        toast.warning("服务连接异常，已切换到总管助手", {
          description: "请检查网络连接后重试",
          duration: 5000,
        })
      }
      useChatStore.getState().setSelectedContactId(PRIMARY_CURATOR.id)
    }
  }, [contactsError])

  const queryClient = useQueryClient()

  React.useEffect(() => {
    if (!window.electronApi?.onInvalidateContacts) return
    const cleanup = window.electronApi.onInvalidateContacts(() => {
      queryClient.invalidateQueries({ queryKey: chatKeys.contacts() })
    })
    return cleanup
  }, [queryClient])

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
    <div
      className={cn(
        "relative flex min-h-0 flex-1",
        isMobile && "flex-col",
        className
      )}
      {...props}
    >
      <WelcomeDialog />
      <UserTour />
      <div className="flex min-w-0 flex-1">
        {!isMobile && <AppToolbar />}

        {!isMobile && activeTab !== "workbench" && (
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

        {activeTab === "chat" && (
          <ChatView
            onOpenContacts={handleOpenContacts}
            onOpenConversations={handleOpenConversations}
            onNewConversation={handleNewConversation}
            className="min-w-0 flex-1"
          />
        )}

        {activeTab === "contacts" && (
          <ContactDetailPanel className="1111 min-w-0 flex-1" />
        )}

        {activeTab === "calendar" && (
          <CalendarPlaceholder variant="content" className="min-w-0 flex-1" />
        )}

        {activeTab === "workbench" && (
          <WorkbenchView className="min-w-0 flex-1" />
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
            onToggleFullscreen={() => {}}
            className="h-full w-full rounded-none border-0 shadow-none"
          />
        </SheetContent>
      </Sheet>

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

      {/* Mobile bottom tab bar */}
      {isMobile && <MobileTabBar />}
    </div>
  )
}
