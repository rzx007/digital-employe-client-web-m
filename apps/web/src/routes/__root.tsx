import { useEffect } from "react"
import { createRootRoute, Outlet, useRouterState } from "@tanstack/react-router"
import { ActivationExpiryNotice } from "@/components/activation/activation-expiry-notice"
import { StreamMetricsOverlay } from "@/components/stream-metrics-overlay"
import { RuntimeProvider } from "@/lib/runtime/runtime-provider"
import { getElectronApi } from "@/lib/electron/host"
import { useAuthStore } from "@/stores/auth-store"
import { cn } from "@workspace/ui/lib/utils"

function RootLayout() {
  const isPetRoute = useRouterState({
    select: (s) => s.location.pathname === "/pet",
  })

  // 跨窗口头像同步：任一窗口上传头像后主进程广播 avatar-updated，
  // 各窗口在此 bump 自己的 avatarVersion，触发本窗口所有 UserAvatar 重取。
  useEffect(() => {
    const api = getElectronApi()
    if (!api?.onAvatarUpdated) return
    return api.onAvatarUpdated(() => {
      useAuthStore.getState().bumpAvatarVersion()
    })
  }, [])

  return (
    <RuntimeProvider>
      <div
        className={cn(
          "flex flex-col overflow-hidden",
          isPetRoute ? "pet-root-layout h-full bg-transparent" : "h-svh",
        )}
      >
        {!isPetRoute ? <ActivationExpiryNotice /> : null}
        <div
          className={cn(
            "flex min-h-0 flex-1 flex-col overflow-hidden",
            isPetRoute && "pet-root-layout bg-transparent",
          )}
        >
          <Outlet />
        </div>
        {!isPetRoute ? <StreamMetricsOverlay /> : null}
      </div>
    </RuntimeProvider>
  )
}

export const Route = createRootRoute({ component: RootLayout })
