import { createFileRoute } from "@tanstack/react-router"
import { Button } from "@workspace/ui/components/button"
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools"
import { AppSidebar } from "@/components/app-sidebar"
import { RouteBreadcrumb } from "@/components/route-breadcrumb"
import { Separator } from "@workspace/ui/components/separator"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@workspace/ui/components/sidebar"

export const Route = createFileRoute("/demo")({
  component: Index,
})
function Index() {
  return (
    <>
      <SidebarProvider className="h-svh overflow-hidden">
        <AppSidebar />
        <SidebarInset className="min-h-0">
          <header className="flex h-16 shrink-0 items-center gap-2">
            <div className="flex items-center gap-2 px-4">
              <SidebarTrigger className="-ml-1" />
              <Separator
                orientation="vertical"
                className="mr-2 data-[orientation=vertical]:h-4"
              />
              <RouteBreadcrumb />
            </div>
          </header>
          <div className="flex min-h-0 flex-1">
            <div className="min-h-0 flex-1 overflow-auto">
              <div className="flex min-h-svh p-6">
                <div className="flex max-w-md min-w-0 flex-col gap-4 text-sm leading-loose">
                  <div>
                    <h1 className="font-medium">Project ready!</h1>
                    <p>You may now add components and start building.</p>
                    <p>
                      We&apos;ve already added the button component for you.
                    </p>
                    <Button className="mt-2">Button</Button>
                  </div>
                  <div className="font-mono text-xs text-muted-foreground">
                    (Press <kbd>d</kbd> to toggle dark mode)
                  </div>
                </div>
              </div>
            </div>
          </div>
        </SidebarInset>
      </SidebarProvider>
      <TanStackRouterDevtools />
    </>
  )
}
