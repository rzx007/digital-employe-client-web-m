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
import { enterDraftConversation } from "@/lib/chat/conversation-selection"
import {
  useCuratorConversationQuery,
} from "@/hooks/use-chat-queries"
import { useChatStore } from "@/stores/chat-store"
import { useArtifactStore } from "@/stores/artifact-store"

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
  const selectedContact = useChatStore((s) => s.getSelectedContact())
  const selectedConversationId = useChatStore((s) => s.selectedConversationId)
  const openConversationList = useChatStore((s) => s.openConversationList)
  const { data: defaultCuratorConv } = useCuratorConversationQuery()

  const handleNewCuratorConversation = useCallback(() => {
    enterDraftConversation()
  }, [])

  const handleOpenCuratorConversations = useCallback(() => {
    openConversationList()
  }, [openConversationList])

  const curatorConversationId = useMemo(() => {
    if (selectedContact?.type === "curator" && selectedConversationId != null) {
      return selectedConversationId
    }
    return defaultCuratorConv?.id ?? null
  }, [selectedContact, selectedConversationId, defaultCuratorConv?.id])
  const showResources =
    resourcesOpen && curatorConversationId != null

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
    if (curatorConversationId == null) return
    setResourcesOpen((open) => !open)
  }, [curatorConversationId])

  const handleCloseResources = useCallback(() => {
    setResourcesOpen(false)
  }, [])

  const openResource = useArtifactStore((s) => s.openResource)

  const handleOpenResourceFile = useCallback(
    (path: string) => {
      if (curatorConversationId == null) return
      setResourcesOpen(true)
      openResource(path)
    },
    [curatorConversationId, openResource],
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
          <div className="h-full min-h-0 overflow-auto p-3">{children}</div>
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
          {curatorConversationId != null ? (
            <CuratorView
              conversationId={curatorConversationId}
              size="compact"
              className={cn(
                "h-full min-h-0",
                showResources ? "border-r" : "border-l",
              )}
              resourcesOpen={showResources}
              onToggleResources={handleToggleResources}
              onOpenResourceFile={handleOpenResourceFile}
              onOpenConversations={handleOpenCuratorConversations}
              onNewConversation={handleNewCuratorConversation}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              加载总管会话…
            </div>
          )}
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
          {showResources && curatorConversationId != null && (
            <div className="h-full bg-muted/20 p-3">
              <ArtifactPanel
                presentation="embedded"
                conversationId={curatorConversationId}
                isOpen
                onClose={handleCloseResources}
                className="h-full rounded-lg border shadow-xl"
              />
            </div>
          )}
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  )
}
