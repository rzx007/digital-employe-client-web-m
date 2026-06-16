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
  IconLayoutSidebarRightCollapse,
  IconLayoutSidebarRightExpand,
} from "@tabler/icons-react"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@workspace/ui/components/resizable"
import { Button } from "@workspace/ui/components/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"
import { ArtifactPanel } from "@/components/artifact"
import { CuratorView } from "@/components/chat/curator/curator-view"
import {
  selectWorkbenchCuratorConversation,
} from "@/lib/chat/conversation-selection"
import { ensureCuratorConversationAndSelect } from "@/lib/chat/curator-conversation-actions"
import { resolveWorkbenchCuratorPanel } from "./resolve-workbench-curator-panel"
import {
  useConversationsQuery,
  useCuratorConversationQuery,
} from "@/hooks/use-chat-queries"
import { useCreateCuratorConversation } from "@/hooks/use-create-curator-conversation"
import { chatKeys } from "@/lib/query-keys/chat"
import { useChatStore } from "@/stores/chat-store"
import { useArtifactStore } from "@/stores/artifact-store"
import { useQueryClient } from "@tanstack/react-query"
import { WorkbenchCuratorSessionsSheet } from "./workbench-curator-sessions-sheet"

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
  const [curatorCollapsed, setCuratorCollapsed] = useState(false)
  const [curatorSessionsOpen, setCuratorSessionsOpen] = useState(false)
  const queryClient = useQueryClient()
  const { createCuratorConversation, isPending: isCreatingCurator } =
    useCreateCuratorConversation()

  const contacts = useChatStore((s) => s.contacts)
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

  const curatorContactId = curatorContact?.curator?.id ?? null
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

  const handleNewCuratorConversation = useCallback(() => {
    if (!curatorContact || isCreatingCurator) return
    void createCuratorConversation(curatorContact, undefined, {
      selectScope: "workbench",
    }).then(() => {
      setCuratorSessionsOpen(false)
      setResourcesOpen(false)
    })
  }, [
    curatorContact,
    createCuratorConversation,
    isCreatingCurator,
  ])

  const handleOpenCuratorConversations = useCallback(() => {
    setCuratorSessionsOpen(true)
  }, [])

  const handleSelectWorkbenchCuratorConversation = useCallback(
    (conversationId: string | number) => {
      selectWorkbenchCuratorConversation(conversationId)
      setCuratorSessionsOpen(false)
    },
    []
  )

  const showResources = resourcesOpen && activeConversationId != null
  // 资源面板打开时必须显示总管栏，故只有资源关闭时折叠才生效
  const curatorEffectivelyCollapsed = curatorCollapsed && !showResources

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
    if (activeConversationId == null) return
    setResourcesOpen((open) => !open)
  }, [activeConversationId])

  const handleCloseResources = useCallback(() => {
    setResourcesOpen(false)
  }, [])

  const openResource = useArtifactStore((s) => s.openResource)

  const handleOpenResourceFile = useCallback(
    (path: string) => {
      if (activeConversationId == null) return
      setResourcesOpen(true)
      openResource(path)
    },
    [activeConversationId, openResource],
  )

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

  // 总管栏折叠/展开（仅资源关闭时生效）。折叠后宽度归还给左侧看板网格。
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      if (curatorEffectivelyCollapsed) {
        curatorPanelRef.current?.collapse()
      } else if (!showResources) {
        curatorPanelRef.current?.expand()
      }
    })
    return () => cancelAnimationFrame(id)
  }, [curatorEffectivelyCollapsed, showResources, curatorPanelRef])

  const handleToggleCuratorCollapsed = useCallback(() => {
    setCuratorCollapsed((v) => !v)
  }, [])

  const handleLayoutChanged = useCallback(
    (layout: Layout) => {
      if (showResources) return
      // 总管栏折叠态是临时的（不持久化），避免把 curator≈0 的瞬时布局写进 localStorage
      if (curatorEffectivelyCollapsed) return

      const resources = layout.resources ?? 0
      if (typeof resources === "number" && resources > 0.5) {
        resourcesPanelRef.current?.collapse()
      }

      const clamped = clampClosedResourcesLayout(layout)
      onLayoutChanged(clamped)
    },
    [showResources, curatorEffectivelyCollapsed, onLayoutChanged, resourcesPanelRef],
  )

  const curatorPanelBorder = showResources ? "border-r" : "border-l"

  const renderCuratorPanel = () => {
    if (panel.mode === "loading" || !curatorContact) {
      return (
        <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
          {isCreatingCurator ? "创建会话…" : "加载总管会话…"}
        </div>
      )
    }

    if (activeConversationId == null) {
      return (
        <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
          {isCreatingCurator ? "创建会话…" : "加载总管会话…"}
        </div>
      )
    }

    return (
      <CuratorView
        key={String(activeConversationId)}
        contact={curatorContact}
        conversationId={activeConversationId}
        title={conversationTitle}
        size="compact"
        className={cn("h-full min-h-0", curatorPanelBorder)}
        resourcesOpen={showResources}
        onToggleResources={handleToggleResources}
        onOpenResourceFile={handleOpenResourceFile}
        onOpenConversations={handleOpenCuratorConversations}
        onNewConversation={handleNewCuratorConversation}
      />
    )
  }

  // 总管栏可折叠的入口仅在资源面板关闭时提供（资源打开时总管必须可见）
  const showCuratorCollapseToggle = !showResources

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden bg-background">
      {showCuratorCollapseToggle && curatorEffectivelyCollapsed && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="icon-sm"
                className="absolute top-2 right-2 z-20 shadow-sm"
                aria-label="展开总管栏"
                onClick={handleToggleCuratorCollapsed}
              >
                <IconLayoutSidebarRightExpand className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>展开总管栏</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
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
          <div className="h-full min-h-0 overflow-auto p-3">{children}</div>
        </ResizablePanel>

        {!showResources && !curatorEffectivelyCollapsed && (
          <ResizableHandle withHandle className="z-10 bg-border" />
        )}

        <ResizablePanel
          id="curator"
          panelRef={curatorPanelRef}
          collapsible
          collapsedSize={0}
          defaultSize={`${CURATOR_WIDTH_PX}px`}
          minSize={`${CURATOR_MIN_WIDTH_PX}px`}
          maxSize={showResources ? "60%" : "55%"}
          className="min-w-0"
        >
          <div className="relative h-full min-h-0">
            {showCuratorCollapseToggle && !curatorEffectivelyCollapsed && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="absolute top-1.5 left-1.5 z-20 size-6 text-muted-foreground hover:text-foreground"
                      aria-label="收起总管栏"
                      onClick={handleToggleCuratorCollapsed}
                    >
                      <IconLayoutSidebarRightCollapse className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>收起总管栏</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            {renderCuratorPanel()}
          </div>
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
          {showResources && activeConversationId != null && (
            <div className="h-full bg-muted/20 p-3">
              <ArtifactPanel
                presentation="embedded"
                conversationId={activeConversationId}
                isOpen
                onClose={handleCloseResources}
                className="h-full rounded-lg border shadow-xl"
              />
            </div>
          )}
        </ResizablePanel>
      </ResizablePanelGroup>

      <WorkbenchCuratorSessionsSheet
        open={curatorSessionsOpen}
        onOpenChange={setCuratorSessionsOpen}
        curatorContact={curatorContact}
        selectedConversationId={activeConversationId}
        onSelectConversation={handleSelectWorkbenchCuratorConversation}
      />
    </div>
  )
}
