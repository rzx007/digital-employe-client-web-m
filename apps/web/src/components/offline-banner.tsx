"use client"

import { useEffect, useState } from "react"
import { cn } from "@workspace/ui/lib/utils"

export function OfflineBanner({ className }: { className?: string }) {
  const [offline, setOffline] = useState(
    typeof navigator !== "undefined" && navigator.onLine === false
  )

  useEffect(() => {
    const handleOffline = () => setOffline(true)
    const handleOnline = () => setOffline(false)

    window.addEventListener("offline", handleOffline)
    window.addEventListener("online", handleOnline)

    return () => {
      window.removeEventListener("offline", handleOffline)
      window.removeEventListener("online", handleOnline)
    }
  }, [])

  if (!offline) return null

  return (
    <div
      className={cn(
        "text-destructive-foreground fixed right-0 bottom-0 left-0 z-50 bg-destructive px-4 py-2 text-center text-xs",
        className
      )}
    >
      网络已断开，请检查连接
    </div>
  )
}
