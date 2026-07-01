import { useDebounceFn } from "ahooks"
import { useCallback } from "react"

const DEFAULT_WAIT_MS = 800

/**
 * 总管「新建对话」点击防抖：首次立即触发，短时间内重复点击忽略。
 */
export function useDebouncedCuratorNewConversation(
  onNewConversation?: () => void,
  waitMs: number = DEFAULT_WAIT_MS
) {
  const { run } = useDebounceFn(
    () => {
      onNewConversation?.()
    },
    { wait: waitMs, leading: true, trailing: false }
  )

  const handleNewConversation = useCallback(() => {
    if (!onNewConversation) return
    run()
  }, [onNewConversation, run])

  return handleNewConversation
}
