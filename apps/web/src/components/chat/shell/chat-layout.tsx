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
import { useScheduledRunNotifications } from "@/hooks/use-scheduled-run-notifications"
import { conversationListQueryKey } from "@/lib/chat/conversation-list-query-key"
import { chatKeys } from "@/lib/query-keys/chat"
import { modelKeys } from "@/lib/query-keys/model"
import { getElectronApi } from "@/lib/electron/host"
import { useArtifactStore } from "@/stores/artifact-store"
import { useMonitorStore } from "@/stores/monitor-store"
import { useChatStore } from "@/stores/chat-store"
import { useSubtaskPanelStore } from "@/stores/subtask-panel-store"
import { useEmployeeTasksPanelStore } from "@/stores/employee-tasks-panel-store"
import { useShellTasksPanelStore } from "@/stores/shell-tasks-panel-store"
import { SubtaskPanel } from "../panel/subtask-panel"
import { EmployeeTasksPanel } from "../panel/employee-tasks-panel"
import { ShellTasksPanel } from "../panel/shell-tasks-panel"
import { useConversationStatusStore } from "@/stores/conversation-status-store"
import { AppToolbar } from "./app-toolbar"
import { SkillsPage } from "@/components/skills"
import { ChatView } from "../views/chat-view"
import { ContactDetailPanel } from "../contacts/contact-detail-panel"
import { ContactsPanel } from "../contacts/contacts-panel"
import { MobileTabBar } from "./mobile-tab-bar"
import { ConversationSidebar } from "../conversations/conversation-sidebar"
import { WorkbenchView } from "../views/workbench-view"
import { BrowserConfirmationHost } from "../right-panels/browser-confirmation-host"
import { BrowserPanel } from "../right-panels/browser-panel"
import { BrowserWidthSlider } from "../right-panels/browser-width-slider"
import { useBrowserStore } from "@/stores/browser-store"

type RightPanel =
  | "artifact"
  | "monitor"
  | "browser"
  | "subtask"
  | "employee-tasks"
  | "shell-tasks"

const RIGHT_PANEL_SHELL = "shrink-0 overflow-hidden border-l bg-muted/20 p-3"

/** Monitor / ConversationList 侧栏宽度（Artifact 仍用 flex-7） */
const NARROW_RIGHT_PANEL_WIDTH = "w-[min(480px,38vw)]"

export function ChatLayout({ className, ...props }: ComponentProps<"div">) {
  const isMobile = useIsMobile()
  const activeTab = useChatStore((s) => s.activeTab)
  const setActiveTab = useChatStore((s) => s.setActiveTab)
  const setContacts = useChatStore((s) => s.setContacts)

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

  const refetchShellExecutions = useCallback(() => {
    void queryClient.refetchQueries({
      queryKey: [...chatKeys.all, "shell-executions"],
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
            queryKey: conversationListQueryKey(
              `employee:${event.employee_id}`
            ),
          })
        }
        break
      case "orchestrator_turn_started":
        // 服务端发起的总管增量汇报流：refetch 总管会话消息，让 use-conversation-session
        // 看到 streaming 占位后 resume/attach 到该流、实时显示。
        if (event.orchestrator_conversation_id) {
          queryClient.invalidateQueries({
            queryKey: chatKeys.messages(
              String(event.orchestrator_conversation_id)
            ),
          })
        }
        break
      case "orchestration_plan_generated":
        queryClient.invalidateQueries({
          queryKey: [...chatKeys.all, "orchestration-plans"],
        })
        break
      case "shell_task_started":
      case "shell_task_finished":
        // 后台命令起/止：刷新后台命令快照，指示条与面板近实时更新。
        refetchShellExecutions()
        break
    }
  })

  useScheduledRunNotifications()

  useEffect(() => {
    if (activeTab === "calendar") {
      setActiveTab("workbench")
    }
  }, [activeTab, setActiveTab])

  useEffect(() => {
    if (apiContacts) {
      setContacts(apiContacts)
      const state = useChatStore.getState()
      state.migrateLegacyEmployeeSelection()

      const { selectedContactId, detailContactId } = useChatStore.getState()
      const hasChatSelected = apiContacts.some(
        (c) => getContactId(c) === selectedContactId
      )
      if (!hasChatSelected) {
        const firstCurator = apiContacts.find((c) => c.type === "curator")
        if (firstCurator?.curator) {
          useChatStore
            .getState()
            .setSelectedContactId(
              getContactId(firstCurator) ?? firstCurator.curator.id
            )
        }
      }

      if (
        detailContactId &&
        !apiContacts.some((c) => getContactId(c) === detailContactId)
      ) {
        useChatStore.getState().setDetailContactId(null)
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
  const isEmployeeTasksPanelOpen = useEmployeeTasksPanelStore((s) => s.isOpen)
  const closeEmployeeTasksPanel = useEmployeeTasksPanelStore((s) => s.close)
  const isShellTasksPanelOpen = useShellTasksPanelStore((s) => s.isOpen)
  const closeShellTasksPanel = useShellTasksPanelStore((s) => s.close)
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
        : isEmployeeTasksPanelOpen
          ? "employee-tasks"
          : isShellTasksPanelOpen
            ? "shell-tasks"
            : isMonitorOpen
              ? "monitor"
              : null

  const hasRightPanel = rightPanel !== null
  const isBrowserRightPanel = rightPanel === "browser"
  // 浏览器最小化后即显示恢复入口——即便其它 panel 正占着右栏（点恢复会收起该 panel
   // 并重显浏览器），让用户随时把后台保活的浏览器调回来。
  const showBrowserRestoreFab =
    activeTab === "chat" && isBrowserMinimized && !isBrowserOpen

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
                <ConversationSidebar
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

        {hasRightPanel &&
          activeTab === "chat" &&
          rightPanel === "employee-tasks" && (
            <div className={cn(RIGHT_PANEL_SHELL, NARROW_RIGHT_PANEL_WIDTH)}>
              <EmployeeTasksPanel
                curatorConversationId={artifactPanelConversationId}
                curatorContactId={selectedContact?.curator?.id}
                onClose={closeEmployeeTasksPanel}
                className="h-full rounded-xl"
              />
            </div>
          )}

        {hasRightPanel &&
          activeTab === "chat" &&
          rightPanel === "shell-tasks" && (
            <div className={cn(RIGHT_PANEL_SHELL, NARROW_RIGHT_PANEL_WIDTH)}>
              <ShellTasksPanel
                conversationId={artifactPanelConversationId}
                onClose={closeShellTasksPanel}
                className="h-full rounded-xl"
              />
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
