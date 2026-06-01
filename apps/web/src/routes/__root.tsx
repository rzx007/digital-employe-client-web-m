import { createRootRoute, Outlet } from "@tanstack/react-router"
import { ActivationExpiryNotice } from "@/components/activation/activation-expiry-notice"
import { AppStatusBar } from "@/components/app-status-bar"
import { RuntimeProvider } from "@/lib/runtime/runtime-provider"

const RootLayout = () => (
  <RuntimeProvider>
    <div className="flex h-svh flex-col overflow-hidden">
      <ActivationExpiryNotice />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <Outlet />
      </div>
      <AppStatusBar />
    </div>
  </RuntimeProvider>
)

export const Route = createRootRoute({ component: RootLayout })
