import { useQuery } from "@tanstack/react-query"

import { chatKeys } from "@/lib/query-keys/chat"
import { request } from "@/lib/request"
import { getActiveWorkspaceId } from "@/lib/workspace-id"

export type ShellExecutionStatus = "running" | "finished" | "killed"

/** 后台 shell 命令执行的会话级快照（由 SHELL_EXECUTE 工具下发）。 */
export interface ShellExecution {
  session_id: string
  command: string
  intent: string | null
  status: ShellExecutionStatus
  running: boolean
  exit_code: number | null
  /** 起始挂钟时间（epoch 秒） */
  started_wall: number
  /** 已耗时（秒） */
  elapsed_seconds: number
}

/** 当前会话下发的后台 shell 命令执行记录（10s 轮询 + SSE invalidate 近实时）。 */
export function useShellExecutions(
  conversationId: string | number | null | undefined
) {
  const id = conversationId != null ? String(conversationId) : null
  return useQuery({
    queryKey: chatKeys.shellExecutions(id ?? "none"),
    queryFn: async ({ signal }) => {
      const res = await request<{
        code: number
        data: ShellExecution[]
      }>(
        `/workspaces/${getActiveWorkspaceId()}/tasks/shell-executions?conversation_id=${id}`,
        { signal }
      )
      return res.data ?? []
    },
    enabled: id != null,
    staleTime: 5_000,
    refetchInterval: 10_000,
  })
}
