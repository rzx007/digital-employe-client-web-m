import { useArtifactStore } from "@/stores/artifact-store"
import { useBrowserStore } from "@/stores/browser-store"
import { useMonitorStore } from "@/stores/monitor-store"
import { useTasksPanelStore } from "@/stores/tasks-panel-store"

/** 关闭产物 / 监控 / 浏览器 / 合并任务（子任务·后台命令·员工任务）等右侧栏 */
export function resetChatRightPanels() {
  useArtifactStore.getState().closeArtifact()
  useMonitorStore.getState().closeMonitor()
  useBrowserStore.getState().destroyBrowser()
  useTasksPanelStore.getState().close()
}
