import type { WorkbenchConfig, HtmlTab, HtmlArtifactRef } from "@/types/workbench"
import { DASHBOARD_TAB_ID } from "@/types/workbench"

export const WORKBENCH_CONFIG_CHANGED_EVENT = "workbench-config-changed"
export const WORKBENCH_OPEN_RESOURCES_EVENT = "workbench-open-resources"

export function emitWorkbenchConfigChanged(): void {
  window.dispatchEvent(new CustomEvent(WORKBENCH_CONFIG_CHANGED_EVENT))
}

export function emptyConfig(): WorkbenchConfig {
  return {
    dashboard: { widgets: [] },
    htmlTabs: [],
    tabOrder: [DASHBOARD_TAB_ID],
    activeTabId: DASHBOARD_TAB_ID,
    updatedAt: 0,
  }
}

function genTabId(): string {
  return `tab-${Math.random().toString(36).slice(2, 10)}`
}

export function addHtmlTab(
  config: WorkbenchConfig,
  htmlRef: HtmlArtifactRef,
  title: string
): WorkbenchConfig {
  const existing = config.htmlTabs.find(
    (t) =>
      t.htmlRef.conversationId === htmlRef.conversationId &&
      t.htmlRef.resourcePath === htmlRef.resourcePath
  )
  if (existing) return { ...config, activeTabId: existing.id }
  const tab: HtmlTab = { id: genTabId(), title, htmlRef }
  return {
    ...config,
    htmlTabs: [...config.htmlTabs, tab],
    tabOrder: [...config.tabOrder, tab.id],
    activeTabId: tab.id,
  }
}

export function removeTab(config: WorkbenchConfig, tabId: string): WorkbenchConfig {
  if (tabId === DASHBOARD_TAB_ID) return config
  const idx = config.tabOrder.indexOf(tabId)
  const tabOrder = config.tabOrder.filter((id) => id !== tabId)
  const htmlTabs = config.htmlTabs.filter((t) => t.id !== tabId)
  let activeTabId = config.activeTabId
  if (activeTabId === tabId) {
    activeTabId = tabOrder[Math.min(idx, tabOrder.length - 1)] ?? DASHBOARD_TAB_ID
  }
  return { ...config, htmlTabs, tabOrder, activeTabId }
}

export function setActiveTab(config: WorkbenchConfig, tabId: string): WorkbenchConfig {
  return { ...config, activeTabId: tabId }
}

export function reorderTabs(config: WorkbenchConfig, orderedIds: string[]): WorkbenchConfig {
  const ids = orderedIds.filter((id) => id !== DASHBOARD_TAB_ID)
  return { ...config, tabOrder: [DASHBOARD_TAB_ID, ...ids] }
}

export function reorderWidgets(config: WorkbenchConfig, orderedIds: string[]): WorkbenchConfig {
  const byId = new Map(config.dashboard.widgets.map((w) => [w.id, w]))
  const widgets = orderedIds
    .map((id, i) => {
      const w = byId.get(id)
      return w ? { ...w, order: i } : null
    })
    .filter((w): w is NonNullable<typeof w> => w !== null)
  return { ...config, dashboard: { widgets } }
}

export function removeWidget(config: WorkbenchConfig, widgetId: string): WorkbenchConfig {
  return {
    ...config,
    dashboard: {
      widgets: config.dashboard.widgets
        .filter((w) => w.id !== widgetId)
        .map((w, i) => ({ ...w, order: i })),
    },
  }
}

export function resizeWidget(
  config: WorkbenchConfig,
  widgetId: string,
  width: number,
  height: number
): WorkbenchConfig {
  return {
    ...config,
    dashboard: {
      widgets: config.dashboard.widgets.map((w) =>
        w.id === widgetId ? { ...w, width, height } : w
      ),
    },
  }
}
