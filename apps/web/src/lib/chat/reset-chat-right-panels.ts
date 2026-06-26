import { useArtifactStore } from "@/stores/artifact-store"
import { useBrowserStore } from "@/stores/browser-store"
import { useEmployeeTasksPanelStore } from "@/stores/employee-tasks-panel-store"
import { useMonitorStore } from "@/stores/monitor-store"
import { useShellTasksPanelStore } from "@/stores/shell-tasks-panel-store"
import { useSubtaskPanelStore } from "@/stores/subtask-panel-store"

/** 关闭产物 / 监控 / 浏览器 / 子任务 / 员工任务 / 后台命令等右侧栏 */
export function resetChatRightPanels() {
  useArtifactStore.getState().closeArtifact()
  useMonitorStore.getState().closeMonitor()
  useBrowserStore.getState().destroyBrowser()
  useSubtaskPanelStore.getState().close()
  useEmployeeTasksPanelStore.getState().close()
  useShellTasksPanelStore.getState().close()
}
