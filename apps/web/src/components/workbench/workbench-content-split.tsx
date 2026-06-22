"use client"

import type { ReactNode, RefObject } from "react"
import { useCallback, useEffect, useMemo, useState } from "react"
import {
  useDefaultLayout,
  usePanelRef,
  type Layout,
  type PanelImperativeHandle,
} from "react-resizable-panels"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@workspace/ui/components/resizable"
import { cn } from "@workspace/ui/lib/utils"
import { ArtifactPanel } from "@/components/artifact"
import { CuratorView } from "@/components/chat/curator/curator-view"
import { ensureCuratorConversationAndSelect } from "@/lib/chat/curator-conversation-actions"
import { getContactId } from "@/lib/chat/contact-utils"
import { buildWorkbenchSnapshot } from "@/lib/workbench/workbench-context"
import { resolveWorkbenchCuratorPanel } from "./resolve-workbench-curator-panel"
import {
  useConversationsQuery,
  useCuratorConversationQuery,
} from "@/hooks/use-chat-queries"
import { useCreateCuratorConversation } from "@/hooks/use-create-curator-conversation"
import { chatKeys } from "@/lib/query-keys/chat"
import { useChatStore } from "@/stores/chat-store"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { WorkbenchMemberPanel } from "./workbench-member-panel"
import { WorkbenchChatTargetSwitch } from "./workbench-chat-target-switch"
import { WorkbenchResourcePool } from "./workbench-resource-pool"
import { useWorkspaceEvents } from "@/hooks/use-workspace-events"

const LAYOUT_STORAGE_ID = "workbench-grid-curator-resources-v2"
const PANEL_IDS = ["grid", "curator", "resources"] as const

/** 工作台侧栏总管默认宽度（与 CuratorView compact 布局 token 对齐） */
const CURATOR_WIDTH_PX = 360
const CURATOR_MIN_WIDTH_PX = 360

const FALLBACK_LAYOUT: Layout = {
  grid: 65,
  curator: 35,
  resources: 0,
}

/** v4 中 number 表示百分比；resources 为 0 表示折叠 */
function normalizeLayout(layout: Layout | undefined): Layout {
  if (!layout) return FALLBACK_LAYOUT
  const grid = layout.grid
  const curator = layout.curator
  const resources = layout.resources ?? 0
  if (
    typeof grid !== "number" ||
    typeof curator !== "number" ||
    typeof resources !== "number"
  ) {
    return FALLBACK_LAYOUT
  }
  if (curator < 20 || grid < 25) return FALLBACK_LAYOUT
  const sum = grid + curator + resources
  if (sum < 85 || sum > 115) return FALLBACK_LAYOUT
  return { grid, curator, resources }
}

/** 资源面板关闭时，把误分给 resources 的宽度归还给 grid/curator */
function clampClosedResourcesLayout(layout: Layout): Layout {
  const resources = layout.resources ?? 0
  if (typeof resources !== "number" || resources <= 0.5) {
    return { ...layout, resources: 0 }
  }
  const grid = layout.grid
  const curator = layout.curator
  if (typeof grid !== "number" || typeof curator !== "number") {
    return { ...layout, resources: 0 }
  }
  const pairSum = grid + curator
  if (pairSum <= 0) return FALLBACK_LAYOUT
  const scale = 100 / pairSum
  return {
    grid: grid * scale,
    curator: curator * scale,
    resources: 0,
  }
}

function syncPanelCollapse(
  resourcesOpen: boolean,
  gridRef: RefObject<PanelImperativeHandle | null>,
  curatorRef: RefObject<PanelImperativeHandle | null>,
  resourcesRef: RefObject<PanelImperativeHandle | null>,
) {
  if (resourcesOpen) {
    gridRef.current?.collapse()
    resourcesRef.current?.expand()
    requestAnimationFrame(() => {
      curatorRef.current?.resize(`${CURATOR_MIN_WIDTH_PX}px`)
    })
  } else {
    resourcesRef.current?.collapse()
    gridRef.current?.expand()
  }
}

export function WorkbenchContentSplit({
  children,
}: {
  children: ReactNode
}) {
  const [resourcesOpen, setResourcesOpen] = useState(false)
  const [resourceTab, setResourceTab] = useState<"pool" | "files">("pool")
  // 工作台助手当前会话 id（由 WorkbenchMemberPanel 上报），供「文件」tab 列其产物。
  const [assistantConversationId, setAssistantConversationId] = useState<
    string | number | null
  >(null)
  const queryClient = useQueryClient()
  const { isPending: isCreatingCurator } = useCreateCuratorConversation()

  const contacts = useChatStore((s) => s.contacts)

  // ── 右侧对话：总管 ⇄ 工作台助手 二选一切换（默认总管）──
  const [chatTarget, setChatTarget] = useState<"curator" | "assistant">(
    "curator"
  )
  // 工作台助手 = 名为「工作台助手」的种子员工 contact
  const assistantContact = useMemo(
    () =>
      contacts.find(
        (c) => c.type === "employee" && c.employee?.name === "工作台助手"
      ) ?? null,
    [contacts]
  )
  const assistantEmployeeId = assistantContact?.employee?.id
    ? Number(assistantContact.employee.id)
    : null

  // 派单：总管把任务派给工作台助手时，工作台弹 toast 引导切过去看进度。
  useWorkspaceEvents(
    useCallback(
      (event) => {
        if (event.type !== "task_started") return
        if (assistantEmployeeId == null) return
        if (event.employee_id !== assistantEmployeeId) return
        toast(`${event.employee_name} 开始做「${event.task_name}」`, {
          action: {
            label: "去工作台查看",
            onClick: () => setChatTarget("assistant"),
          },
        })
      },
      [assistantEmployeeId]
    )
  )
  const workbenchCuratorConversationId = useChatStore(
    (s) => s.workbenchCuratorConversationId
  )
  const setWorkbenchCuratorConversationId = useChatStore(
    (s) => s.setWorkbenchCuratorConversationId
  )
  const { data: defaultCuratorConv } = useCuratorConversationQuery()

  const curatorContact = useMemo(
    () => contacts.find((c) => c.type === "curator"),
    [contacts]
  )

  // 用带前缀的 contactId（curator:5），与全局选中态 / 创建会话写入的会话列表缓存 key 一致；
  // 否则裸 id "5" 读不到创建时写到 "curator:5" 下的新会话 → 新建对话不刷新、要切菜单才出现。
  const curatorContactId = getContactId(curatorContact) ?? null
  const defaultCuratorConversationId = defaultCuratorConv?.id ?? null

  const { data: curatorConversations = [], isSuccess: curatorConversationsReady } =
    useConversationsQuery(curatorContactId, curatorContact)

  const panel = useMemo(
    () =>
      resolveWorkbenchCuratorPanel({
        curatorContactId,
        workbenchCuratorConversationId,
        curatorConversations,
        curatorConversationsReady,
        defaultCuratorConversationId,
      }),
    [
      curatorContactId,
      curatorConversations,
      curatorConversationsReady,
      defaultCuratorConversationId,
      workbenchCuratorConversationId,
    ]
  )

  useEffect(() => {
    if (!curatorContactId || !curatorConversationsReady) return
    if (curatorConversations.length > 0) return

    void queryClient.invalidateQueries({ queryKey: chatKeys.curator() })
    void queryClient.invalidateQueries({
      queryKey: chatKeys.conversations(curatorContactId),
    })
  }, [
    curatorContactId,
    curatorConversations.length,
    curatorConversationsReady,
    queryClient,
  ])

  useEffect(() => {
    if (!curatorContact || panel.mode !== "loading") return
    if (isCreatingCurator) return
    void ensureCuratorConversationAndSelect(queryClient, curatorContact, {
      selectScope: "workbench",
    }).catch(() => {})
  }, [curatorContact, panel.mode, isCreatingCurator, queryClient])

  const activeConversationId = panel.conversationId ?? null

  useEffect(() => {
    if (panel.mode === "loading") return
    if (activeConversationId == null || !curatorConversationsReady) return

    const currentId = useChatStore.getState().workbenchCuratorConversationId
    if (String(currentId) === String(activeConversationId)) return

    setWorkbenchCuratorConversationId(activeConversationId)
  }, [
    activeConversationId,
    curatorConversationsReady,
    panel.mode,
    setWorkbenchCuratorConversationId,
  ])

  const conversationTitle = useMemo(() => {
    if (activeConversationId == null) return undefined
    return (
      curatorConversations.find(
        (c) => String(c.id) === String(activeConversationId)
      )?.title ?? "总管对话"
    )
  }, [activeConversationId, curatorConversations])

  // 资源池不依赖会话，故只要 resourcesOpen 即展开（文件页另行处理无会话情形）。
  const showResources = resourcesOpen

  const gridPanelRef = usePanelRef()
  const curatorPanelRef = usePanelRef()
  const resourcesPanelRef = usePanelRef()

  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: LAYOUT_STORAGE_ID,
    panelIds: [...PANEL_IDS],
    storage: localStorage,
  })

  const resolvedLayout = useMemo(
    () => normalizeLayout(defaultLayout),
    [defaultLayout],
  )

  const handleToggleResources = useCallback(() => {
    setResourcesOpen((open) => !open)
  }, [])

  const handleCloseResources = useCallback(() => {
    setResourcesOpen(false)
  }, [])

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      syncPanelCollapse(
        showResources,
        gridPanelRef,
        curatorPanelRef,
        resourcesPanelRef,
      )
    })
    return () => cancelAnimationFrame(id)
  }, [showResources, gridPanelRef, curatorPanelRef, resourcesPanelRef])

  const handleLayoutChanged = useCallback(
    (layout: Layout) => {
      if (showResources) return

      const resources = layout.resources ?? 0
      if (typeof resources === "number" && resources > 0.5) {
        resourcesPanelRef.current?.collapse()
      }

      const clamped = clampClosedResourcesLayout(layout)
      onLayoutChanged(clamped)
    },
    [showResources, onLayoutChanged, resourcesPanelRef],
  )

  const curatorPanelBorder = showResources ? "border-r" : "border-l"

  const renderMemberArea = () => {
    // 对话头部标题处的「总管 ⇄ 工作台助手」下拉切换（替代纯标题，干净）。
    const targetSwitch = (
      <WorkbenchChatTargetSwitch
        value={chatTarget}
        onChange={setChatTarget}
        assistantAvailable={!!assistantContact}
      />
    )
    return (
      <div className={cn("flex h-full min-h-0 flex-col", curatorPanelBorder)}>
        <div className="min-h-0 flex-1">
          {chatTarget === "assistant" ? (
            assistantContact ? (
              <WorkbenchMemberPanel
                key={`assistant-${assistantEmployeeId}`}
                contact={assistantContact}
                onOpenArtifact={() => setResourcesOpen(true)}
                onActiveConversation={setAssistantConversationId}
                titleSlot={targetSwitch}
              />
            ) : (
              <div className="flex h-full items-center justify-center px-4 text-center text-xs text-muted-foreground">
                未找到「工作台助手」员工
              </div>
            )
          ) : !curatorContact || activeConversationId == null ? (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              {isCreatingCurator ? "创建会话…" : "加载总管会话…"}
            </div>
          ) : (
            <CuratorView
              key={String(activeConversationId)}
              contact={curatorContact}
              conversationId={activeConversationId}
              title={conversationTitle}
              size="compact"
              className="h-full min-h-0"
              resourcesOpen={showResources}
              onToggleResources={handleToggleResources}
              onOpenResourceFile={() => setResourcesOpen(true)}
              titleSlot={targetSwitch}
              getExtraMetadata={() => ({ workbench: buildWorkbenchSnapshot() })}
            />
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden bg-background">
      <ResizablePanelGroup
        id={LAYOUT_STORAGE_ID}
        orientation="horizontal"
        className="h-full min-h-0 w-full"
        defaultLayout={resolvedLayout}
        onLayoutChanged={handleLayoutChanged}
      >
        <ResizablePanel
          id="grid"
          panelRef={gridPanelRef}
          collapsible
          collapsedSize={0}
          defaultSize="70%"
          minSize="35%"
          className="min-w-0"
        >
          {/* 隐藏外层网格滚动条但保留滚动（与看板格子内一致，整体更干净） */}
          <div className="h-full min-h-0 overflow-auto p-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {children}
          </div>
        </ResizablePanel>

        {!showResources && (
          <ResizableHandle withHandle className="z-10 bg-border" />
        )}

        <ResizablePanel
          id="curator"
          panelRef={curatorPanelRef}
          defaultSize={`${CURATOR_WIDTH_PX}px`}
          minSize={`${CURATOR_MIN_WIDTH_PX}px`}
          maxSize={showResources ? "60%" : "55%"}
          className="min-w-0"
        >
          {renderMemberArea()}
        </ResizablePanel>

        {showResources && (
          <ResizableHandle withHandle className="z-10 bg-border" />
        )}

        <ResizablePanel
          id="resources"
          panelRef={resourcesPanelRef}
          collapsible
          collapsedSize={0}
          defaultSize={0}
          minSize={showResources ? "25%" : "0%"}
          maxSize={showResources ? undefined : "0%"}
          className="min-w-0"
        >
          {showResources && (
            <div className="flex h-full flex-col bg-muted/20 p-3">
              <div className="mb-2 flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setResourceTab("pool")}
                  className={cn(
                    "rounded px-2 py-1 text-xs",
                    resourceTab === "pool"
                      ? "bg-background font-medium shadow-sm"
                      : "text-muted-foreground"
                  )}
                >
                  资源池
                </button>
                <button
                  type="button"
                  onClick={() => setResourceTab("files")}
                  className={cn(
                    "rounded px-2 py-1 text-xs",
                    resourceTab === "files"
                      ? "bg-background font-medium shadow-sm"
                      : "text-muted-foreground"
                  )}
                >
                  文件
                </button>
                <button
                  type="button"
                  onClick={handleCloseResources}
                  className="ml-auto rounded px-2 py-1 text-xs text-muted-foreground"
                >
                  关闭
                </button>
              </div>
              <div className="min-h-0 flex-1">
                {(() => {
                  if (resourceTab === "pool") {
                    return (
                      <WorkbenchResourcePool className="h-full rounded-lg border bg-background shadow-xl" />
                    )
                  }
                  // 「文件」tab 跟随当前对话对象：助手 → 助手会话产物；总管 → 总管会话产物。
                  const filesConversationId =
                    chatTarget === "assistant"
                      ? assistantConversationId
                      : activeConversationId
                  return filesConversationId != null ? (
                    <ArtifactPanel
                      key={String(filesConversationId)}
                      presentation="embedded"
                      conversationId={filesConversationId}
                      isOpen
                      onClose={handleCloseResources}
                      className="h-full rounded-lg border shadow-xl"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                      暂无会话文件
                    </div>
                  )
                })()}
              </div>
            </div>
          )}
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  )
}
