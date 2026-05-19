import { useState, useEffect, useRef, type ComponentProps } from "react"
import { useSize } from "ahooks"

import { Sheet, SheetContent } from "@workspace/ui/components/sheet"
import { cn } from "@workspace/ui/lib/utils"
import { useQueryClient } from "@tanstack/react-query"
import { ArtifactPanel } from "@/components/artifact"
import { MonitorPanel } from "@/components/schedule-monitor"
import { OfflineBanner } from "@/components/offline-banner"
import { useIsMobile } from "@/hooks/use-mobile"
import { useContactsQuery } from "@/hooks/use-chat-queries"
import { useWorkspaceEvents } from "@/hooks/use-workspace-events"
import { useTaskExecutionNotifications } from "@/hooks/use-task-execution-notifications"
import { chatKeys } from "@/lib/query-keys/chat"
import { modelKeys } from "@/lib/query-keys/model"
import { getElectronApi } from "@/lib/electron/host"
import { useArtifactStore } from "@/stores/artifact-store"
import { useMonitorStore } from "@/stores/monitor-store"
import { useChatStore } from "@/stores/chat-store"
import { useConversationStatusStore } from "@/stores/conversation-status-store"
import { useOnboardingStore } from "@/stores/onboarding-store"
import { WelcomeDialog, UserTour } from "@/components/onboarding"
import { AppToolbar } from "./app-toolbar"
import { ShiftCalendarPage } from "@/components/shift-calendar"
import { SkillsPage } from "@/components/skills"
import { ChatView } from "../views/chat-view"
import { ContactDetailPanel } from "../contacts/contact-detail-panel"
import { ContactsPanel } from "../contacts/contacts-panel"
import { ConversationList } from "../conversations/conversation-list"
import { MobileTabBar } from "./mobile-tab-bar"
import { RecentConversations } from "../conversations/recent-conversations"
import { WorkbenchView } from "../views/workbench-view"

export function ChatLayout({ className, ...props }: ComponentProps<"div">) {
  const isMobile = useIsMobile()
  const activeTab = useChatStore((s) => s.activeTab)
  const setContacts = useChatStore((s) => s.setContacts)
  const showWelcome = useOnboardingStore((s) => s.showWelcome)
  const onboardingCompleted = useOnboardingStore((s) => s.onboardingCompleted)
  const initialized = useOnboardingStore((s) => s.initialized)
  const initOnboarding = useOnboardingStore((s) => s.initOnboarding)

  const { data: apiContacts } = useContactsQuery()

  const queryClient = useQueryClient()

  useWorkspaceEvents((event) => {
    queryClient.invalidateQueries({
      queryKey: [...chatKeys.all, "all-task-executions"],
    })
    queryClient.invalidateQueries({
      queryKey: [...chatKeys.all, "today-all-executions"],
    })
    switch (event.type) {
      case "conversation_status_changed":
        useConversationStatusStore.getState().setStatus(
          event.conversation_id,
          event.status,
          event.target_type,
          event.target_id,
        )
        break
      case "task_completed":
      case "task_failed":
      case "task_started":
        queryClient.invalidateQueries({
          queryKey: [...chatKeys.all, "notifications"],
        })
        break
      case "orchestration_plan_generated":
        queryClient.invalidateQueries({
          queryKey: [...chatKeys.all, "orchestration-plans"],
        })
        break
    }
  })

  useTaskExecutionNotifications()

  useEffect(() => {
    initOnboarding()
  }, [initOnboarding])

  useEffect(() => {
    if (initialized && !onboardingCompleted) {
      const timer = setTimeout(() => showWelcome(), 1500)
      return () => clearTimeout(timer)
    }
  }, [initialized, onboardingCompleted, showWelcome])

  useEffect(() => {
    if (apiContacts) {
      setContacts(apiContacts)
      const { selectedContactId } = useChatStore.getState()
      const hasSelected = apiContacts.some((c) => {
        if (c.type === "curator") return c.curator?.id === selectedContactId
        if (c.type === "employee") return c.employee?.id === selectedContactId
        return c.group?.id === selectedContactId
      })
      if (!hasSelected) {
        const firstCurator = apiContacts.find((c) => c.type === "curator")
        if (firstCurator?.curator) {
          useChatStore.getState().setSelectedContactId(firstCurator.curator.id)
        }
      }
    }
  }, [apiContacts, setContacts])

  useEffect(() => {
    const api = getElectronApi()
    if (!api?.onInvalidateContacts) return
    const cleanup = api.onInvalidateContacts(() => {
      queryClient.invalidateQueries({ queryKey: chatKeys.contacts() })
    })
    return cleanup
  }, [queryClient])

  useEffect(() => {
    const api = getElectronApi()
    if (!api?.onInvalidateModelConfig) return
    const cleanup = api.onInvalidateModelConfig(() => {
      queryClient.invalidateQueries({ queryKey: modelKeys.runtimeConfig() })
    })
    return cleanup
  }, [queryClient])

  const [showConversations, setShowConversations] = useState(false)

  const { closeArtifact, isPanelOpen } = useArtifactStore()

  const {
    isOpen: isMonitorOpen,
    isFullscreen: isMonitorFullscreen,
    closeMonitor,
    toggleFullscreen: toggleMonitorFullscreen,
    setFullscreen: setMonitorFullscreen,
  } = useMonitorStore()

  const selectedConversationId = useChatStore((s) => s.selectedConversationId)

  useEffect(() => {
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

  const layoutRef = useRef<HTMLDivElement>(null)
  const layoutSize = useSize(layoutRef)
  const layoutWidth = layoutSize?.width ?? 0

  const shouldCollapseRecent = isPanelOpen && !isMobile && layoutWidth < 1902

  const setCompactMode = useChatStore((s) => s.setCompactMode)
  useEffect(() => {
    setCompactMode(shouldCollapseRecent)
  }, [shouldCollapseRecent, setCompactMode])

  const showMonitorSheet = isMonitorOpen && activeTab === "chat"

  return (
    <div
      ref={layoutRef}
      className={cn(
        "relative flex min-h-0 flex-1",
        isMobile && "flex-col",
        className
      )}
      {...props}
    >
      <WelcomeDialog />
      <UserTour />
      <div className="flex min-h-0 min-w-0 flex-1">
        {!isMobile && <AppToolbar />}

        {!isMobile &&
          activeTab !== "workbench" &&
          activeTab !== "calendar" &&
          activeTab !== "skills" && (
            <div
              className={cn(
                "hidden shrink-0 transition-[width] duration-300 md:flex md:min-h-0 md:flex-col",
                shouldCollapseRecent ? "w-16" : "w-64"
              )}
            >
              {activeTab === "chat" && (
                <RecentConversations
                  className="h-full w-full"
                  collapsed={shouldCollapseRecent}
                />
              )}
              {activeTab === "contacts" && (
                <ContactsPanel className="h-full w-full" />
              )}
            </div>
          )}

        {activeTab === "chat" && (
          <ChatView
            onOpenContacts={handleOpenContacts}
            onOpenConversations={handleOpenConversations}
            onNewConversation={handleNewConversation}
            className={cn(
              "min-w-0",
              isPanelOpen && !isMobile ? "flex-[3]" : "flex-1"
            )}
          />
        )}

        {activeTab === "contacts" && (
          <ContactDetailPanel className="1111 min-w-0 flex-1" />
        )}

        {activeTab === "calendar" && (
          <ShiftCalendarPage className="min-w-0 flex-1" />
        )}

        {activeTab === "workbench" && (
          <WorkbenchView className="min-w-0 flex-1" />
        )}

        {activeTab === "skills" && <SkillsPage className="min-w-0 flex-1" />}

        {isPanelOpen && !isMobile && activeTab === "chat" && (
          <div className="min-w-0 flex-[7] overflow-hidden border-l bg-muted/20 p-3">
            <ArtifactPanel
              conversationId={selectedConversationId}
              isOpen={isPanelOpen}
              onClose={closeArtifact}
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
            onToggleFullscreen={() => { }}
            className="h-full w-full rounded-none border-0 shadow-none"
          />
        </SheetContent>
      </Sheet>

      {/* Artifact panel on mobile */}
      <Sheet
        open={isPanelOpen && isMobile && activeTab === "chat"}
        onOpenChange={(open) => {
          if (!open) closeArtifact()
        }}
      >
        <SheetContent side="right" className="w-[92vw] p-0 sm:w-[640px]">
          <ArtifactPanel
            conversationId={selectedConversationId}
            isOpen={isPanelOpen}
            onClose={closeArtifact}
            className="h-full rounded-none border-0 shadow-none"
          />
        </SheetContent>
      </Sheet>

      {/* Monitor fullscreen (non-chat tab) */}
      {isMonitorOpen && isMonitorFullscreen && activeTab !== "chat" && (
        <MonitorPanel
          isOpen={isMonitorOpen}
          isFullscreen={isMonitorFullscreen}
          onToggleFullscreen={toggleMonitorFullscreen}
        />
      )}

      {/* Mobile bottom tab bar */}
      {isMobile && <MobileTabBar />}

      <OfflineBanner />
    </div>
  )
}
