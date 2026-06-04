import { useEffect, useState } from "react"

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
export interface GroupStreamingMessage {
  sourceConversationId: number
  senderId: number | null
  senderLabel: string
  text: string
  /** 累计已生成字符数（后端 acc 权威值，用于“正在生成 N 字”进度，超长生成时尤其有用） */
  charCount: number
}

export function useGroupRoom(conversationId: string | number | null) {
  const queryClient = useQueryClient()
  const convKey = String(conversationId ?? "")
  // 成员逐字流式：sourceConvId -> 累积文本（完成后由 room_message 落库并清除）
  const [streaming, setStreaming] = useState<
    Record<number, GroupStreamingMessage>
  >({})

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
    if (event.type === "room_message_stream") {
      if (String(event.room_conversation_id) !== convKey) return
      // 成员/组长逐字流式：累积到对应 source 的进行中消息
      setStreaming((prev) => {
        const src = event.source_conversation_id
        const cur = prev[src]
        const nextText = event.first
          ? event.delta
          : (cur?.text ?? "") + event.delta
        return {
          ...prev,
          [src]: {
            sourceConversationId: src,
            senderId: event.sender_id,
            senderLabel: event.sender_label || "成员",
            text: nextText,
            // 优先用后端权威累计字数 acc；缺失时回退到本地文本长度
            charCount: event.acc ?? nextText.length,
          },
        }
      })
      return
    }
    if (event.type === "room_message") {
      if (String(event.room_conversation_id) !== convKey) return
      // 落库的完整消息到了 → 清掉对应的流式临时态（避免重复显示）
      setStreaming((prev) => {
        const next = { ...prev }
        for (const k of Object.keys(next)) {
          const m = next[Number(k)]
          if (m && m.senderId === event.sender_id) delete next[Number(k)]
        }
        return next
      })
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

  // 切换会话时：清空上一个会话的流式临时态 + 拉一次最新房间状态。
  // 清空是切会话的合理副作用（旧会话的逐字流式不应残留到新会话），故此处
  // 显式 setState；规则误判，精确 disable。
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStreaming({})
    if (conversationId) {
      refresh()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convKey])

  return {
    room: roomQuery.data ?? null,
    members: roomQuery.data?.members ?? [],
    dag: dagQuery.data ?? null,
    streaming: Object.values(streaming),
    isLoading: roomQuery.isPending,
  }
}
