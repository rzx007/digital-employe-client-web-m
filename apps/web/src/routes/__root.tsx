import { createRootRoute, Outlet, useRouterState } from "@tanstack/react-router"
import { ActivationExpiryNotice } from "@/components/activation/activation-expiry-notice"
import { StreamMetricsOverlay } from "@/components/stream-metrics-overlay"
import { RuntimeProvider } from "@/lib/runtime/runtime-provider"
import { cn } from "@workspace/ui/lib/utils"

function RootLayout() {
  const isPetRoute = useRouterState({
    select: (s) => s.location.pathname === "/pet",
  })

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
