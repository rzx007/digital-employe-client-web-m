import { IconFileTypeHtml, IconLayoutDashboard, IconX } from "@tabler/icons-react"
import { cn } from "@workspace/ui/lib/utils"
import { DASHBOARD_TAB_ID } from "@/types/workbench"
import type { WorkbenchConfig } from "@/types/workbench"
import {
  setActiveTab,
  removeTab,
  reorderWidgets,
  removeWidget,
  resizeWidget,
} from "@/lib/workbench/workbench-config"
import { DraggableWorkbenchGrid } from "./draggable-workbench-grid"
import { WorkbenchHtmlPanel } from "./workbench-html-panel"

interface WorkbenchTabsProps {
  config: WorkbenchConfig
  onChange: (next: WorkbenchConfig) => void
}

function TabCloseButton({
  tabId,
  isActive,
  onClose,
}: {
  tabId: string
  isActive: boolean
  onClose: () => void
}) {
  return (
    <span
      role="button"
      tabIndex={0}
      data-testid={`close-${tabId}`}
      title="关闭标签"
      onPointerDown={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          e.stopPropagation()
          onClose()
        }
      }}
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground",
        "transition-[opacity,background-color,color] duration-150 ease-out",
        "hover:bg-muted hover:text-foreground",
        isActive
          ? "opacity-100"
          : "opacity-0 group-hover/tab:opacity-100"
      )}
    >
      <IconX className="size-3" stroke={2} />
    </span>
  )
}

type TabEntry =
  | { kind: "dashboard"; id: string }
  | { kind: "html"; id: string; title: string }

export function WorkbenchTabs({ config, onChange }: WorkbenchTabsProps) {
  const activeTabId = config.activeTabId ?? DASHBOARD_TAB_ID

  const entries: TabEntry[] = config.tabOrder
    .map((id): TabEntry | null => {
      if (id === DASHBOARD_TAB_ID) {
        return { kind: "dashboard", id }
      }
      const htmlTab = config.htmlTabs.find((t) => t.id === id)
      if (!htmlTab) return null
      return { kind: "html", id, title: htmlTab.title }
    })
    .filter((entry): entry is TabEntry => entry !== null)

  const activeHtmlTab =
    activeTabId !== DASHBOARD_TAB_ID
      ? config.htmlTabs.find((t) => t.id === activeTabId) ?? null
      : null

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        role="tablist"
        className={cn(
          "flex shrink-0 items-end gap-0 overflow-x-auto border-b border-border bg-muted/60 px-1 pt-1",
          "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        )}
      >
        {entries.map((entry, index) => {
          const isActive = entry.id === activeTabId
          const prevId = entries[index - 1]?.id
          const showDivider =
            index > 0 && !isActive && prevId !== activeTabId

          return (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => onChange(setActiveTab(config, entry.id))}
              className={cn(
                "group/tab relative flex h-8 min-w-[120px] max-w-[220px] shrink-0 items-center gap-2 rounded-t-[10px] px-3 text-xs font-medium",
                "transition-[background-color,color] duration-150 ease-out",
                showDivider &&
                "before:absolute before:top-1/2 before:left-0 before:h-4 before:w-px before:-translate-y-1/2 before:bg-border/80 before:content-['']",
                isActive
                  ? "z-10 -mb-px border border-b-0 border-border bg-background text-foreground"
                  : "text-muted-foreground hover:bg-muted/80 hover:text-foreground"
              )}
            >
              {entry.kind === "dashboard" ? (
                <IconLayoutDashboard
                  className="size-4 shrink-0 text-muted-foreground"
                  stroke={1.5}
                />
              ) : (
                <IconFileTypeHtml
                  className="size-4 shrink-0 text-muted-foreground"
                  stroke={1.5}
                />
              )}
              <span className="min-w-0 flex-1 truncate text-left">
                {entry.kind === "dashboard" ? "看板" : entry.title}
              </span>
              {entry.kind === "html" ? (
                <TabCloseButton
                  tabId={entry.id}
                  isActive={isActive}
                  onClose={() => onChange(removeTab(config, entry.id))}
                />
              ) : (
                <span className="size-5 shrink-0" aria-hidden />
              )}
            </button>
          )
        })}
      </div>

      <div
        role="tabpanel"
        className="min-h-0 flex-1 overflow-auto bg-background"
      >
        {activeTabId === DASHBOARD_TAB_ID || !activeHtmlTab ? (
          <div className="min-h-full bg-muted/30 p-4">
            <DraggableWorkbenchGrid
              widgets={config.dashboard.widgets}
              onReorder={(ids) => onChange(reorderWidgets(config, ids))}
              onRemoveWidget={(widgetId) =>
                onChange(removeWidget(config, widgetId))
              }
              onResizeWidget={(widgetId, w, h) =>
                onChange(resizeWidget(config, widgetId, w, h))
              }
            />
          </div>
        ) : (
          <WorkbenchHtmlPanel
            htmlRef={activeHtmlTab.htmlRef}
            title={activeHtmlTab.title}
            className="h-full w-full "
          />
        )}
      </div>
    </div>
  )
}
