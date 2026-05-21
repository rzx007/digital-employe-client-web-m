"use client"

import type { ReactNode } from "react"
import { useMemo } from "react"
import { useDefaultLayout, type Layout } from "react-resizable-panels"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@workspace/ui/components/resizable"
import { CuratorView } from "@/components/chat/curator/curator-view"

const LAYOUT_STORAGE_ID = "workbench-grid-curator"
const PANEL_IDS = ["grid", "curator"] as const

/** 改版前 Curator 固定 w-[400px] */
const CURATOR_WIDTH_PX = 400

const FALLBACK_LAYOUT: Layout = {
  grid: 65,
  curator: 35,
}

/** v4 中 number 表示 px；百分比须用带 % 的字符串 */
function normalizeLayout(layout: Layout | undefined): Layout {
  if (!layout) return FALLBACK_LAYOUT
  const grid = layout.grid
  const curator = layout.curator
  if (typeof grid !== "number" || typeof curator !== "number") {
    return FALLBACK_LAYOUT
  }
  if (curator < 28 || grid < 30) return FALLBACK_LAYOUT
  const sum = grid + curator
  if (sum < 85 || sum > 115) return FALLBACK_LAYOUT
  return { grid, curator }
}

export function WorkbenchContentSplit({
  children,
}: {
  children: ReactNode
}) {
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: LAYOUT_STORAGE_ID,
    panelIds: [...PANEL_IDS],
    storage: localStorage,
  })

  const resolvedLayout = useMemo(
    () => normalizeLayout(defaultLayout),
    [defaultLayout],
  )

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <ResizablePanelGroup
        id={LAYOUT_STORAGE_ID}
        orientation="horizontal"
        className="h-full min-h-0 w-full"
        defaultLayout={resolvedLayout}
        onLayoutChanged={onLayoutChanged}
      >
        <ResizablePanel
          id="grid"
          defaultSize="70%"
          minSize="35%"
          className="min-w-0"
        >
          <div className="h-full min-h-0 overflow-auto p-3">{children}</div>
        </ResizablePanel>
        <ResizableHandle withHandle className="z-10 bg-border" />
        <ResizablePanel
          id="curator"
          defaultSize={`${CURATOR_WIDTH_PX}px`}
          minSize={`${CURATOR_WIDTH_PX}px`}
          maxSize="55%"
          className="min-w-0"
        >
          <CuratorView
            size="compact"
            className="h-full min-h-0 border-l px-1"
          />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  )
}
