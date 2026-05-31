import {
  selectConversationForContact,
  selectWorkbenchCuratorConversation,
} from "@/lib/chat/conversation-selection"
import type { ActiveTab } from "@/stores/chat-store"
import { useChatStore } from "@/stores/chat-store"

export type CuratorNavigationReturn = {
  curatorContactId: string
  curatorConversationId: string | number
  employeeId: string
  employeeConversationId: string | number
  returnTab: ActiveTab
}

export function navigateToEmployeeFromCurator(options: {
  curatorContactId: string
  curatorConversationId: string | number
  employeeId: string
  employeeConversationId: string | number
}) {
  const state = useChatStore.getState()
  const returnCtx: CuratorNavigationReturn = {
    curatorContactId: options.curatorContactId,
    curatorConversationId: options.curatorConversationId,
    employeeId: options.employeeId,
    employeeConversationId: options.employeeConversationId,
    returnTab: state.activeTab,
  }
  state.setCuratorNavigationReturn(returnCtx)
  selectConversationForContact(
    options.employeeId,
    options.employeeConversationId
  )
  state.setActiveTab("chat")
}

export function returnToCuratorFromEmployeeNavigation(): boolean {
  const state = useChatStore.getState()
  const ctx = state.curatorNavigationReturn
  if (!ctx) return false

  state.clearCuratorNavigationReturn()

  if (ctx.returnTab === "workbench") {
    state.setActiveTab("workbench")
    selectWorkbenchCuratorConversation(ctx.curatorConversationId)
    return true
  }

  selectConversationForContact(
    ctx.curatorContactId,
    ctx.curatorConversationId
  )
  state.setActiveTab("chat")
  return true
}

export function shouldShowCuratorReturnBar(
  ctx: CuratorNavigationReturn | null,
  selectedContactId: string | null,
  selectedConversationId: string | number | null
): boolean {
  if (!ctx) return false
  if (selectedContactId !== ctx.employeeId) return false
  return String(selectedConversationId) === String(ctx.employeeConversationId)
}
