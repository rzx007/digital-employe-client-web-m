import { useArtifactStore } from "@/stores/artifact-store"
import { useChatStore } from "@/stores/chat-store"
import { useMonitorStore } from "@/stores/monitor-store"

/** 关闭产物 / 监控 / 会话列表等右侧栏 */
export function resetChatRightPanels() {
  useArtifactStore.getState().closeArtifact()
  useMonitorStore.getState().closeMonitor()
  useChatStore.getState().closeConversationList()
}
