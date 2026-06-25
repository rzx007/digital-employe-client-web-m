import { useQuery } from "@tanstack/react-query"

import { chatKeys } from "@/lib/query-keys/chat"
import { request } from "@/lib/request"
import { getActiveWorkspaceId } from "@/lib/workspace-id"

/** 单个后台 shell 命令的输出日志快照（tail，最多 ~64KB）。 */
export interface ShellExecutionOutput {
  found: boolean
  running: boolean
  exit_code: number | null
  status: string
  command: string
  intent: string | null
  /** 日志尾部（UTF-8） */
  output: string
  /** 为 true 表示更早的输出已被省略 */
  truncated_head: boolean
  total_size: number
}

/**
 * 拉取单个后台 shell 命令的输出日志。
 * 仅在行展开时启用（enabled）；进行中（running）时每 ~3s 轮询，结束后停止轮询。
 */
export function useShellExecutionOutput(
  sessionId: string,
  { enabled, running }: { enabled: boolean; running: boolean }
) {
  return useQuery({
    queryKey: chatKeys.shellExecutionOutput(sessionId),
    queryFn: async ({ signal }) => {
      const res = await request<{
        code: number
        data: ShellExecutionOutput
      }>(
        `/workspaces/${getActiveWorkspaceId()}/tasks/shell-executions/${sessionId}/output`,
        { signal }
      )
      return res.data
    },
    enabled,
    staleTime: 2_000,
    refetchInterval: running ? 3_000 : false,
  })
}
