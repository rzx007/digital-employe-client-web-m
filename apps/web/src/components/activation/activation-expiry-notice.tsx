import * as React from "react"
import { toast } from "sonner"
import {
  useActivationRequired,
  useActivationStatus,
} from "@/lib/activation/use-activation"

const WARNING_DAYS = 7

/**
 * 主界面挂载：授权剩余 ≤7 天时 toast 提醒一次（每会话）。
 */
export function ActivationExpiryNotice() {
  const required = useActivationRequired()
  const { data } = useActivationStatus(required)
  const shownRef = React.useRef(false)

  React.useEffect(() => {
    if (!required || shownRef.current) return
    const status = data?.data
    if (!status?.activated) return
    const days = status.days_remaining
    if (typeof days !== "number" || days > WARNING_DAYS) return

    shownRef.current = true
    toast.warning(
      days <= 0
        ? "授权已过期，请重新激活"
        : `授权将在 ${days} 天后到期，请提前联系管理员续签`,
      { duration: 8000 },
    )
  }, [required, data])

  return null
}
