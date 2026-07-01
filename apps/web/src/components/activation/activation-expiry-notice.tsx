import * as React from "react"
import { toast } from "sonner"
import { buildActivationExpiryToast } from "@/lib/activation/expiry-message"
import {
  useActivationRequired,
  useActivationStatus,
} from "@/lib/activation/use-activation"

/**
 * 主界面挂载：授权剩余 ≤7 天时 toast 提醒一次（每会话）。
 * 文案基于 expires_at，避免 days_remaining 取整导致误报「已过期」。
 */
export function ActivationExpiryNotice() {
  const required = useActivationRequired()
  const { data } = useActivationStatus(required)
  const shownRef = React.useRef(false)

  React.useEffect(() => {
    if (!required || shownRef.current) return
    const status = data?.data
    if (!status?.activated || !status.expires_at) return

    const message = buildActivationExpiryToast(status.expires_at)
    if (!message) return

    shownRef.current = true
    toast.warning(message, { duration: 8000 })
  }, [required, data])

  return null
}
