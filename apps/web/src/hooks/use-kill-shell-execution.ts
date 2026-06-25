import { useMutation, useQueryClient } from "@tanstack/react-query"

import { chatKeys } from "@/lib/query-keys/chat"
import { request } from "@/lib/request"
import { getActiveWorkspaceId } from "@/lib/workspace-id"

/** 终止后台 shell 命令。成功后失效该会话的 shell-executions 查询以刷新面板。 */
export function useKillShellExecution(
  conversationId: string | number | null | undefined
) {
  const queryClient = useQueryClient()
  const id = conversationId != null ? String(conversationId) : "none"
  return useMutation({
    mutationFn: async (sessionId: string) => {
      const res = await request<{ code: number; data: { killed: boolean } }>(
        `/workspaces/${getActiveWorkspaceId()}/tasks/shell-executions/${sessionId}`,
        { method: "DELETE" }
      )
      return res.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: chatKeys.shellExecutions(id),
      })
    },
  })
}
