import type { AgentRuntime, AgentRuntimeItem } from "./runtime-types"

export const AGENT_SOURCE_LABELS: Record<string, string> = {
  user_chat: "用户聊天",
  orchestration: "委派",
  scheduled: "定时",
  hitl_resume: "审批续跑",
}

export function agentSourceLabel(source: string): string {
  return AGENT_SOURCE_LABELS[source] ?? source
}

export interface AgentStatusPresentation {
  agentLabel: string
  emphasize: boolean
  expandable: boolean
}

export function formatAgentStatus(
  agent: AgentRuntime | undefined
): AgentStatusPresentation {
  if (!agent) {
    return {
      agentLabel: "Agent 空闲",
      emphasize: false,
      expandable: false,
    }
  }

  const active = agent.active_streams ?? 0
  const queued = agent.queued_starts ?? 0
  const max = agent.max_concurrent_streams
  const serial = agent.serial_mode
  const activeItems = agent.active_items ?? []
  const queuedItems = agent.queued_items ?? []

  const expandable =
    queued > 0 || activeItems.length > 0 || queuedItems.length > 0

  if (serial && max > 0) {
    if (queued > 0) {
      return {
        agentLabel: `Agent 排队 ${queued} · ${active}/${max}`,
        emphasize: true,
        expandable,
      }
    }
    if (active > 0) {
      return {
        agentLabel: `Agent ${active}/${max}`,
        emphasize: false,
        expandable,
      }
    }
    return {
      agentLabel: "Agent 空闲",
      emphasize: false,
      expandable,
    }
  }

  if (active > 0) {
    return {
      agentLabel: `Agent 执行 ${active}`,
      emphasize: false,
      expandable,
    }
  }

  return {
    agentLabel: "Agent 空闲",
    emphasize: false,
    expandable,
  }
}

export function mergeRuntimeQueueItems(
  agent: AgentRuntime | undefined
): { running: AgentRuntimeItem[]; waiting: AgentRuntimeItem[] } {
  if (!agent) {
    return { running: [], waiting: [] }
  }
  return {
    running: agent.active_items ?? [],
    waiting: agent.queued_items ?? [],
  }
}
