import { createRootRoute, Outlet } from "@tanstack/react-router"
import { ActivationExpiryNotice } from "@/components/activation/activation-expiry-notice"
import { RuntimeProvider } from "@/lib/runtime/runtime-provider"

const RootLayout = () => (
  <RuntimeProvider>
    <ActivationExpiryNotice />
    <Outlet />
  </RuntimeProvider>
)

export const Route = createRootRoute({ component: RootLayout })
