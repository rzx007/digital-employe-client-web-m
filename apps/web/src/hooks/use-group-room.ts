import { useEffect } from "react"

import { useQuery, useQueryClient } from "@tanstack/react-query"

import {
  fetchGroupRoomState,
  fetchGroupRoomDag,
  type GroupRoomState,
  type GroupRoomDag,
} from "@/api/group-room"
import { chatKeys } from "@/lib/query-keys/chat"
import { useWorkspaceEvents } from "@/hooks/use-workspace-events"

/**
 * 订阅一个群会话的协作房间状态：
 * - 拉取成员列表 + 角色/状态（成员侧栏用）；
 * - 监听工作空间事件流里的 room_message / room_member_state，
 *   收到时刷新群时间线（messages）与房间状态。
 */
export function useGroupRoom(conversationId: string | number | null) {
  const queryClient = useQueryClient()
  const convKey = String(conversationId ?? "")

  const roomQuery = useQuery<GroupRoomState | null>({
    queryKey: chatKeys.groupRoom(convKey),
    queryFn: ({ signal }) => fetchGroupRoomState(conversationId!, { signal }),
    enabled: Boolean(conversationId),
    staleTime: 5_000,
  })

  const dagQuery = useQuery<GroupRoomDag | null>({
    queryKey: [...chatKeys.groupRoom(convKey), "dag"],
    queryFn: ({ signal }) => fetchGroupRoomDag(conversationId!, { signal }),
    enabled: Boolean(conversationId),
    staleTime: 3_000,
  })

  const refresh = () => {
    void queryClient.invalidateQueries({
      queryKey: chatKeys.groupRoom(convKey),
    })
    void queryClient.invalidateQueries({
      queryKey: [...chatKeys.groupRoom(convKey), "dag"],
    })
  }

  useWorkspaceEvents((event) => {
    if (event.type === "room_message") {
      if (String(event.room_conversation_id) !== convKey) return
      // 群时间线有新消息（成员交付结论 / 用户发言投影）→ 刷新消息 + 房间 + DAG
      void queryClient.invalidateQueries({
        queryKey: chatKeys.messages(convKey),
      })
      refresh()
    } else if (event.type === "room_member_state") {
      const room = roomQuery.data
      if (!room || event.room_id !== room.room_id) return
      refresh()
    } else if (
      event.type === "task_started" ||
      event.type === "task_completed" ||
      event.type === "task_failed" ||
      event.type === "orchestration_plan_generated"
    ) {
      // 组长派活/任务进展也会改变 DAG，刷新
      refresh()
    }
  })

  // 切换会话时确保拉一次最新房间状态
  useEffect(() => {
    if (conversationId) {
      refresh()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convKey])

  return {
    room: roomQuery.data ?? null,
    members: roomQuery.data?.members ?? [],
    dag: dagQuery.data ?? null,
    isLoading: roomQuery.isPending,
  }
}
