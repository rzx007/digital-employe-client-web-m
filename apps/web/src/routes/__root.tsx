import { createRootRoute, Outlet } from "@tanstack/react-router"
import { RuntimeProvider } from "@/lib/runtime/runtime-provider"

const RootLayout = () => (
  <RuntimeProvider>
    <Outlet />
  </RuntimeProvider>
)

export const Route = createRootRoute({ component: RootLayout })
