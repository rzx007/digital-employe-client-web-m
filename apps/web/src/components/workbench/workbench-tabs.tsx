import { IconLayoutDashboard } from "@tabler/icons-react"
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

export function WorkbenchTabs({ config, onChange }: WorkbenchTabsProps) {
  const activeTabId = config.activeTabId ?? DASHBOARD_TAB_ID

  const activeHtmlTab =
    activeTabId !== DASHBOARD_TAB_ID
      ? config.htmlTabs.find((t) => t.id === activeTabId) ?? null
      : null

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Tab strip */}
      <div
        role="tablist"
        className="flex shrink-0 items-end gap-0.5 border-b border-border bg-muted/30 px-2 pt-1"
      >
        {config.tabOrder.map((id) => {
          const isDashboard = id === DASHBOARD_TAB_ID
          const isActive = id === activeTabId

          if (isDashboard) {
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => onChange(setActiveTab(config, id))}
                className={cn(
                  "flex items-center gap-1.5 rounded-t-md border border-b-0 px-3 py-1.5 text-xs font-medium transition-colors",
                  isActive
                    ? "border-border bg-background text-foreground shadow-sm"
                    : "border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                )}
              >
                <IconLayoutDashboard className="size-3.5" stroke={1.5} />
                工作台
              </button>
            )
          }

          const htmlTab = config.htmlTabs.find((t) => t.id === id)
          if (!htmlTab) return null // self-heal: skip stale tabOrder entries

          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => onChange(setActiveTab(config, id))}
              className={cn(
                "group/tab flex items-center gap-1 rounded-t-md border border-b-0 px-3 py-1.5 text-xs font-medium transition-colors",
                isActive
                  ? "border-border bg-background text-foreground shadow-sm"
                  : "border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              )}
            >
              <span className="max-w-[140px] truncate">{htmlTab.title}</span>
              <span
                role="button"
                tabIndex={0}
                data-testid={`close-${id}`}
                title="关闭标签"
                onClick={(e) => {
                  e.stopPropagation()
                  onChange(removeTab(config, id))
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.stopPropagation()
                    onChange(removeTab(config, id))
                  }
                }}
                className={cn(
                  "ml-0.5 flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground/70",
                  "hover:bg-muted hover:text-foreground",
                  "opacity-0 transition-opacity group-hover/tab:opacity-100",
                  isActive && "opacity-60"
                )}
              >
                ×
              </span>
            </button>
          )
        })}
      </div>

      {/* Content area */}
      <div className="min-h-0 flex-1 overflow-auto">
        {activeTabId === DASHBOARD_TAB_ID || !activeHtmlTab ? (
          <div className="p-3">
            <DraggableWorkbenchGrid
              widgets={config.dashboard.widgets}
              onReorder={(ids) => onChange(reorderWidgets(config, ids))}
              onRemoveWidget={(id) => onChange(removeWidget(config, id))}
              onResizeWidget={(id, w, h) =>
                onChange(resizeWidget(config, id, w, h))
              }
            />
          </div>
        ) : (
          <WorkbenchHtmlPanel
            htmlRef={activeHtmlTab.htmlRef}
            title={activeHtmlTab.title}
            className="h-full w-full"
          />
        )}
      </div>
    </div>
  )
}
