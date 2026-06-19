import { useEffect, useRef } from "react"

import { chatTransport } from "@/components/chat/shared/chat-view-shared"

/**
 * 卸载（切会话 / 切联系人 / 切到「消息」等菜单使整棵会话视图卸载 / 群深链 remount）时，
 * 断开本会话尚在进行的 SSE 连接：
 * - resume 流由 transport 内部独立 AbortController 持有，useChat 卸载**不会**自动中止它，
 *   也不会清掉 transport 单例上的 in-flight resume 归属（_reconnectAbort/_reconnectChatId）；
 * - live POST 流走 stop()。
 *
 * 不清理的后果有二：
 * 1) 泄漏长连接——浏览器对同源并发连接数有限（HTTP/1.1 ~6），来回切几次占满连接池，
 *    之后所有后台接口（含 GET /messages）都拿不到 socket → 整页「卡死、无法请求」。
 * 2) 切回重挂时 session effect 想 resume 会被 shouldSkipResumeWhenInFlight 那道「同会话
 *    已有在飞连接」闸挡住 → 气泡空白，直到 idle 看门狗回收死连接或 DB 兜底轮询补回
 *    （工作台总管面板「执行完了才显示正常」的根因）。
 *
 * 后端 turn 仍在跑，切回会话时 effect 会重新 resume 续上，不丢内容。
 *
 * stop 走 latest-value ref：卸载时调最新闭包，避免捕获首渲染的旧 stop。
 */
export function useStreamCleanupOnUnmount(stop: () => void): void {
  const stopRef = useRef(stop)
  useEffect(() => {
    stopRef.current = stop
  }, [stop])
  useEffect(() => {
    return () => {
      chatTransport.cancelReconnect()
      stopRef.current()
    }
  }, [])
}
