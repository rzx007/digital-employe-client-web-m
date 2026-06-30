import { useEffect, useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { cn } from "@workspace/ui/lib/utils"
import { useBrand } from "@/lib/brand/brand"
import { subscribeElectron } from "@/lib/electron/host"

export const Route = createFileRoute("/splash")({
  component: SplashPage,
})

function SplashPage() {
  const brand = useBrand()
  const [status, setStatus] = useState("正在启动服务...")
  const isError = status.includes("失败")

  useEffect(() => {
    return subscribeElectron((api) =>
      api.onBackendError?.((message) => {
        setStatus(`服务启动失败: ${message}`)
      }),
    )
  }, [])

  return (
    <div
      className="flex h-screen w-screen items-center justify-center bg-background"
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      <div className="flex flex-col items-center">
        <img
          src={brand.logos.splash}
          alt={brand.productName}
          className="mb-8 h-[72px] w-auto max-w-[320px] object-contain"
        />
        <div
          className={cn(
            "h-8 w-8 animate-spin rounded-full border-[3px] border-muted",
            isError ? "border-t-destructive" : "border-t-primary",
          )}
        />
        <span
          className={cn(
            "mt-5 text-sm tracking-wide",
            isError ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {status}
        </span>
      </div>
    </div>
  )
}
