import { useEffect, useRef, useState } from "react"

import { useQuery, useQueryClient } from "@tanstack/react-query"

import {
  fetchGroupRoomState,
  fetchGroupRoomDag,
  setGroupRoomAutoConfirm,
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

  // 用户消息 room_message 先于后台 dispatch_to_leader 到达；补拉几次房间状态，
  // 才能在首 token 前把组长判为 running，时间线才能显示「正在生成回复…」。
  const leaderRefreshTimersRef = useRef<ReturnType<typeof setTimeout>[]>([])
  const scheduleLeaderStateRefresh = () => {
    leaderRefreshTimersRef.current.forEach(clearTimeout)
    leaderRefreshTimersRef.current = [400, 1_000, 2_500].map((ms) =>
      setTimeout(() => refresh(), ms)
    )
  }

  const setAutoConfirm = async (enabled: boolean) => {
    if (!conversationId) return
    const next = await setGroupRoomAutoConfirm(conversationId, enabled)
    if (next) {
      queryClient.setQueryData<GroupRoomState | null>(
        chatKeys.groupRoom(convKey),
        next
      )
    }
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
      if (event.role === "user") {
        scheduleLeaderStateRefresh()
      }
      // 落库的完整消息到了 → 只清掉**对应那条 source** 的流式临时态。
      // 关键：按 source_conversation_id 精确匹配，而不是按 senderId。组长 senderId
      // 恒为 null，旧逻辑「senderId 相等就删」会让任何 null-sender 的落库消息把还在
      // 流的组长气泡整段抹掉 → 组长输出「一会有一会没」的闪烁。source 精确匹配后，
      // 只有该 source 自己的最终消息落库才清它，流式过程不再被打断。
      const src = event.source_conversation_id
      if (src != null) {
        setStreaming((prev) => {
          if (!(src in prev)) return prev
          const next = { ...prev }
          delete next[src]
          return next
        })
      } else {
        // 兜底（旧后端无 source 字段）：退回按 senderId 清，但仅清非组长（senderId
        // 非 null）的，避免误伤组长流。组长流会在自身 source 落库或切会话时清。
        setStreaming((prev) => {
          const next = { ...prev }
          let changed = false
          for (const k of Object.keys(next)) {
            const m = next[Number(k)]
            if (m && m.senderId != null && m.senderId === event.sender_id) {
              delete next[Number(k)]
              changed = true
            }
          }
          return changed ? next : prev
        })
      }
      void queryClient.invalidateQueries({
        queryKey: chatKeys.messages(convKey),
      })
      refresh()
    } else if (event.type === "room_member_state") {
      const room = roomQuery.data
      if (!room || event.room_id !== room.room_id) return
      refresh()
    } else if (event.type === "orchestration_plan_generated") {
      // 组长刚创建编排计划：这条事件先于（或不依赖）plan-card 的 room_message 到达。
      // 必须**同时**补拉群时间线消息 + 编排计划状态，否则 plan-card 那条投影消息要等
      // 到下一条 room_message 才被拉出来渲染 = 用户看到的「计划卡要下一轮才弹出来」。
      void queryClient.invalidateQueries({
        queryKey: chatKeys.messages(convKey),
      })
      void queryClient.invalidateQueries({
        queryKey: chatKeys.orchestrationPlans(convKey),
      })
      refresh()
    } else if (
      event.type === "task_started" ||
      event.type === "task_completed" ||
      event.type === "task_failed"
    ) {
      // 任务进展会改变 DAG + 计划卡的进度条/按钮态（确认执行→执行中→已交付），
      // 一并补拉计划状态与群消息，让卡片实时更新。
      void queryClient.invalidateQueries({
        queryKey: chatKeys.orchestrationPlans(convKey),
      })
      void queryClient.invalidateQueries({
        queryKey: chatKeys.messages(convKey),
      })
      refresh()
    }
  }, () => {
    // 断后重连：这条 SSE 无重放，断流窗口内的 room_message_stream/room_message
    // 可能永久丢失。重连后从 DB 补拉时间线 + 房间状态，让已落库的组长/成员产出立即
    // 显示，无需用户手动再发消息。
    // 注意：**不要** setStreaming({})。线程饥饿期会高频断/重连，若每次重连都清空
    // 逐字流式临时态，会把还在流的组长气泡反复抹掉→重建 = 用户看到的「一会有一会没」
    // 闪烁。已落库的消息会通过下面的 messages 补拉接管显示；仍在流的 source 会继续
    // 累积它自己的 delta，其最终消息落库时再按 source 精确清理即可。
    if (!conversationId) return
    void queryClient.invalidateQueries({
      queryKey: chatKeys.messages(convKey),
    })
    refresh()
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

  useEffect(
    () => () => {
      leaderRefreshTimersRef.current.forEach(clearTimeout)
    },
    []
  )

  return {
    room: roomQuery.data ?? null,
    members: roomQuery.data?.members ?? [],
    dag: dagQuery.data ?? null,
    streaming: Object.values(streaming),
    isLoading: roomQuery.isPending,
    autoConfirm: Boolean(roomQuery.data?.auto_confirm_member_tasks),
    setAutoConfirm,
  }
}
