import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import {
  RouterProvider,
  createHashHistory,
  createRouter,
} from "@tanstack/react-router"
import { QueryClientProvider } from "@tanstack/react-query"
import { createAppQueryClient, setQueryClient } from "@/lib/query-client"
import { initTelemetry, track } from "@/lib/telemetry"

import "@workspace/ui/globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { applyBrandTheme, getStoredBrandTheme } from "@/lib/brand/brand-theme"
import { getBrand } from "@/lib/brand/brand"
import { TooltipProvider } from "@workspace/ui/components/tooltip"
import { Toaster } from "@workspace/ui/components/sonner"

// Import the generated route tree
import { routeTree } from "./routeTree.gen"

// Create a new router instance
const hashHistory = createHashHistory()
const router = createRouter({ routeTree, history: hashHistory })

// Register the router instance for type safety
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}

// 渲染前尽早套用品牌主题色 + 窗口标题，避免首帧闪默认值。
// 用户未选过主题色时，回退到品牌包指定的 defaultTheme。
const brand = getBrand()
applyBrandTheme(getStoredBrandTheme(brand.defaultTheme))
document.title = brand.windowTitle

const queryClient = createAppQueryClient()
setQueryClient(queryClient)

// 活跃度埋点：初始化上报通道 + 记录本次启动（未登录时入队，登录后补发）
initTelemetry()
track("app_open")

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <RouterProvider router={router} />
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>
)
