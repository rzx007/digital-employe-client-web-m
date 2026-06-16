import { useCallback, useEffect, useRef, type ComponentProps } from "react"
import { useSize } from "ahooks"
import { IconWorld } from "@tabler/icons-react"
import { toast } from "sonner"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { useQueryClient } from "@tanstack/react-query"
import { ArtifactPanel } from "@/components/artifact"
import { MonitorPanel } from "@/components/schedule-monitor"
import { useIsMobile } from "@/hooks/use-mobile"
import {
  useContactsQuery,
  useConversationsQuery,
} from "@/hooks/use-chat-queries"
import { getContactId } from "@/lib/chat/contact-utils"
import { resetChatRightPanels } from "@/lib/chat/reset-chat-right-panels"
import { useCreateCuratorConversation } from "@/hooks/use-create-curator-conversation"
import { useWorkspaceEvents } from "@/hooks/use-workspace-events"
import { useTaskExecutionNotifications } from "@/hooks/use-task-execution-notifications"
import { chatKeys } from "@/lib/query-keys/chat"
import { modelKeys } from "@/lib/query-keys/model"
import { getElectronApi } from "@/lib/electron/host"
import { useArtifactStore } from "@/stores/artifact-store"
import { useMonitorStore } from "@/stores/monitor-store"
import { useChatStore } from "@/stores/chat-store"
import { useSubtaskPanelStore } from "@/stores/subtask-panel-store"
import { SubtaskPanel } from "../panel/subtask-panel"
import { useConversationStatusStore } from "@/stores/conversation-status-store"
import { useOnboardingStore } from "@/stores/onboarding-store"
import { WelcomeDialog, UserTour } from "@/components/onboarding"
import { AppToolbar } from "./app-toolbar"
import { SkillsPage } from "@/components/skills"
import { ChatView } from "../views/chat-view"
import { ContactDetailPanel } from "../contacts/contact-detail-panel"
import { ContactsPanel } from "../contacts/contacts-panel"
import { ConversationList } from "../conversations/conversation-list"
import { MobileTabBar } from "./mobile-tab-bar"
import { RecentConversations } from "../conversations/recent-conversations"
import { WorkbenchView } from "../views/workbench-view"
import { BrowserConfirmationHost } from "../right-panels/browser-confirmation-host"
import { BrowserPanel } from "../right-panels/browser-panel"
import { BrowserWidthSlider } from "../right-panels/browser-width-slider"
import { useBrowserStore } from "@/stores/browser-store"

type RightPanel =
  | "artifact"
  | "monitor"
  | "conversations"
  | "browser"
  | "subtask"

const RIGHT_PANEL_SHELL = "shrink-0 overflow-hidden border-l bg-muted/20 p-3"

/** Monitor / ConversationList 侧栏宽度（Artifact 仍用 flex-7） */
const NARROW_RIGHT_PANEL_WIDTH = "w-[min(480px,38vw)]"

export function ChatLayout({ className, ...props }: ComponentProps<"div">) {
  const isMobile = useIsMobile()
  const activeTab = useChatStore((s) => s.activeTab)
  const setActiveTab = useChatStore((s) => s.setActiveTab)
  const setContacts = useChatStore((s) => s.setContacts)
  const showWelcome = useOnboardingStore((s) => s.showWelcome)
  const onboardingCompleted = useOnboardingStore((s) => s.onboardingCompleted)
  const initialized = useOnboardingStore((s) => s.initialized)
  const initOnboarding = useOnboardingStore((s) => s.initOnboarding)

  const { data: apiContacts } = useContactsQuery()

  const queryClient = useQueryClient()

  const refetchTaskExecutionQueries = useCallback(() => {
    void queryClient.refetchQueries({
      queryKey: [...chatKeys.all, "all-task-executions"],
    })
    void queryClient.refetchQueries({
      queryKey: [...chatKeys.all, "curator-executions"],
    })
    void queryClient.refetchQueries({
      queryKey: [...chatKeys.all, "today-all-executions"],
    })
  }, [queryClient])

  useWorkspaceEvents((event) => {
    refetchTaskExecutionQueries()
    switch (event.type) {
      case "conversation_status_changed":
        useConversationStatusStore
          .getState()
          .setStatus(
            event.conversation_id,
            event.status,
            event.target_type,
            event.target_id
          )
        break
      case "task_completed":
      case "task_failed":
      case "task_started":
        refetchTaskExecutionQueries()
        queryClient.invalidateQueries({
          queryKey: [...chatKeys.all, "notifications"],
        })
        if (
          (event.type === "task_completed" || event.type === "task_failed") &&
          event.orchestrator_conversation_id
        ) {
          queryClient.invalidateQueries({
            queryKey: chatKeys.messages(
              String(event.orchestrator_conversation_id)
            ),
          })
        }
        // 当任务开始时，重新获取对应员工的会话列表
        if (event.type === "task_started") {
          queryClient.invalidateQueries({
            queryKey: chatKeys.conversations(String(event.employee_id)),
          })
        }
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
    if (activeTab === "calendar") {
      setActiveTab("workbench")
    }
  }, [activeTab, setActiveTab])

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
      // 用 getContactId（带 type 前缀）统一匹配，避免裸 id 与前缀化选择 id 不一致
      const hasSelected = apiContacts.some(
        (c) => getContactId(c) === selectedContactId
      )
      if (!hasSelected) {
        const firstCurator = apiContacts.find((c) => c.type === "curator")
        if (firstCurator?.curator) {
          useChatStore
            .getState()
            .setSelectedContactId(
              getContactId(firstCurator) ?? firstCurator.curator.id
            )
        }
      }
    }
  }, [apiContacts, setContacts])

  // 当联系人列表发生变化时，重新获取联系人列表
  useEffect(() => {
    if (activeTab !== "contacts") return
    void queryClient.invalidateQueries({ queryKey: chatKeys.contacts() })
  }, [activeTab, queryClient])

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

  const { closeArtifact, isPanelOpen } = useArtifactStore()
  const { isOpen: isMonitorOpen, closeMonitor } = useMonitorStore()
  const isSubtaskPanelOpen = useSubtaskPanelStore((s) => s.isOpen)
  const isConversationListOpen = useChatStore((s) => s.isConversationListOpen)
  const openConversationList = useChatStore((s) => s.openConversationList)
  const closeConversationList = useChatStore((s) => s.closeConversationList)
  const isBrowserOpen = useBrowserStore((s) => s.isOpen)
  const isBrowserMinimized = useBrowserStore((s) => s.isMinimized)
  const isBrowserFullscreen = useBrowserStore((s) => s.isFullscreen)
  const restoreBrowser = useBrowserStore((s) => s.restoreBrowser)
  const destroyBrowser = useBrowserStore((s) => s.destroyBrowser)
  const browserWidthRatio = useBrowserStore((s) => s.widthRatio)

  useEffect(() => {
    if (activeTab === "chat") return
    destroyBrowser()
  }, [activeTab, destroyBrowser])

  const selectedContactId = useChatStore((s) => s.selectedContactId)
  const selectedConversationId = useChatStore((s) => s.selectedConversationId)
  const isDraftConversation = useChatStore((s) => s.isDraftConversation)
  const selectedContact = useChatStore((s) => s.getSelectedContact())
  const { data: conversations = [] } = useConversationsQuery(
    selectedContactId,
    selectedContact
  )
  const { createCuratorConversation, isPending: isCreatingCurator } =
    useCreateCuratorConversation()
  const resetRightPanels = useCallback(() => {
    resetChatRightPanels()
  }, [])

  const conversationKey = isDraftConversation
    ? `draft:${selectedContactId ?? "none"}`
    : selectedConversationId != null
      ? `conversation:${selectedConversationId}`
      : selectedContactId != null
        ? `contact:${selectedContactId}`
        : "none"

  const prevConversationKeyRef = useRef(conversationKey)

  useEffect(() => {
    if (prevConversationKeyRef.current === conversationKey) return
    prevConversationKeyRef.current = conversationKey
    destroyBrowser()
  }, [conversationKey, destroyBrowser])

  const prevConversationCountRef = useRef<number | null>(null)
  const prevContactIdForConvRef = useRef<string | null>(null)

  useEffect(() => {
    if (activeTab !== "chat") return

    if (selectedContactId !== prevContactIdForConvRef.current) {
      prevContactIdForConvRef.current = selectedContactId
      prevConversationCountRef.current = null
    }

    const count = conversations.length
    const prevCount = prevConversationCountRef.current
    prevConversationCountRef.current = count

    if (
      selectedContactId &&
      prevCount != null &&
      prevCount > 0 &&
      count === 0
    ) {
      resetRightPanels()
    }
  }, [activeTab, selectedContactId, conversations, resetRightPanels])
  const artifactPanelConversationId = selectedConversationId

  const handleNewConversation = () => {
    if (selectedContact?.type === "curator") {
      if (isCreatingCurator) return
      void createCuratorConversation(selectedContact)
      return
    }
    // 阶段4：员工单聊退场，不再新建员工会话；派活统一走总管。
    toast.info("员工不再单独对话，请通过总管派活")
  }

  const handleOpenConversations = () => {
    openConversationList()
  }

  const handleOpenContacts = () => {
    useChatStore.getState().setActiveTab("contacts")
  }

  const layoutRef = useRef<HTMLDivElement>(null)
  const layoutSize = useSize(layoutRef)
  const layoutWidth = layoutSize?.width ?? 0

  const rightPanel: RightPanel | null = isBrowserOpen
    ? "browser"
    : isPanelOpen
      ? "artifact"
      : isSubtaskPanelOpen
        ? "subtask"
        : isMonitorOpen
          ? "monitor"
          : isConversationListOpen
            ? "conversations"
            : null

  const hasRightPanel = rightPanel !== null
  const isBrowserRightPanel = rightPanel === "browser"
  const showBrowserRestoreFab =
    activeTab === "chat" &&
    isBrowserMinimized &&
    !isBrowserOpen &&
    !hasRightPanel

  const shouldCollapseRecent =
    activeTab === "chat" && hasRightPanel && layoutWidth < 1902

  const setCompactMode = useChatStore((s) => s.setCompactMode)
  useEffect(() => {
    setCompactMode(shouldCollapseRecent)
  }, [shouldCollapseRecent, setCompactMode])

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
      <BrowserConfirmationHost />
      <div className="chat-layout-root flex min-h-0 min-w-0 flex-1">
        {!isMobile && !isBrowserFullscreen && <AppToolbar />}

        {!isMobile &&
          !isBrowserFullscreen &&
          activeTab !== "workbench" &&
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

        {activeTab === "chat" && !isBrowserFullscreen && (
          <ChatView
            onOpenContacts={handleOpenContacts}
            onOpenConversations={handleOpenConversations}
            onNewConversation={handleNewConversation}
            isNewConversationPending={isCreatingCurator}
            className={cn(
              "min-h-0 min-w-0",
              isBrowserRightPanel
                ? "shrink-0"
                : hasRightPanel
                  ? "flex-3"
                  : "flex-1"
            )}
            style={
              isBrowserRightPanel
                ? { width: `${(1 - browserWidthRatio) * 100}%` }
                : undefined
            }
          />
        )}

        {activeTab === "contacts" && (
          <ContactDetailPanel className="min-w-0 flex-1" />
        )}

        {activeTab === "workbench" && (
          <WorkbenchView className="min-w-0 flex-1" />
        )}

        {activeTab === "skills" && <SkillsPage className="min-w-0 flex-1" />}

        {hasRightPanel && activeTab === "chat" && rightPanel === "artifact" && (
          <div className={cn(RIGHT_PANEL_SHELL, "min-w-0 flex-7")}>
            <ArtifactPanel
              conversationId={artifactPanelConversationId}
              isOpen={isPanelOpen}
              onClose={closeArtifact}
              className="h-full rounded-xl"
            />
          </div>
        )}

        {hasRightPanel && activeTab === "chat" && rightPanel === "subtask" && (
          <div className={cn(RIGHT_PANEL_SHELL, NARROW_RIGHT_PANEL_WIDTH)}>
            <SubtaskPanel className="h-full rounded-xl" />
          </div>
        )}

        {hasRightPanel && activeTab === "chat" && rightPanel === "monitor" && (
          <div className={cn(RIGHT_PANEL_SHELL, NARROW_RIGHT_PANEL_WIDTH)}>
            <MonitorPanel
              isOpen={isMonitorOpen}
              onClose={closeMonitor}
              className="h-full rounded-xl"
            />
          </div>
        )}

        {hasRightPanel &&
          activeTab === "chat" &&
          rightPanel === "conversations" && (
            <div className={cn(RIGHT_PANEL_SHELL, NARROW_RIGHT_PANEL_WIDTH)}>
              <ConversationList
                className="h-full rounded-xl border shadow-xl"
                onClose={closeConversationList}
                onSelectConversation={closeConversationList}
              />
            </div>
          )}

        {hasRightPanel && activeTab === "chat" && rightPanel === "browser" && (
          <>
            {!isBrowserFullscreen && <BrowserWidthSlider />}
            <div
              className={cn(
                RIGHT_PANEL_SHELL,
                "flex min-h-0 min-w-0 flex-col border-l bg-muted/20 p-3",
                isBrowserFullscreen && "flex-1 border-l-0"
              )}
              style={
                isBrowserFullscreen
                  ? undefined
                  : { width: `${browserWidthRatio * 100}%` }
              }
            >
              <BrowserPanel />
            </div>
          </>
        )}
      </div>

      {showBrowserRestoreFab && (
        <Button
          variant="secondary"
          size="icon"
          className="absolute top-1/2 right-3 z-30 -translate-y-1/2 rounded-full border shadow-lg"
          onClick={restoreBrowser}
          title="恢复浏览器"
        >
          <IconWorld className="size-5" />
        </Button>
      )}

      {isMobile && <MobileTabBar />}
    </div>
  )
}
