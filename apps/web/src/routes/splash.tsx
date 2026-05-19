import { useEffect, useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { cn } from "@workspace/ui/lib/utils"
import logoImage from "@/assets/logo.png"
import { getElectronApi } from "@/lib/electron/host"

export const Route = createFileRoute("/splash")({
  component: SplashPage,
})

function SplashPage() {
  const [status, setStatus] = useState("正在启动服务...")
  const isError = status.includes("失败")

  useEffect(() => {
    const cleanup = getElectronApi()?.onBackendError?.((message) => {
      setStatus(`服务启动失败: ${message}`)
    })
    return () => cleanup?.()
  }, [])

  return (
    <div
      className="flex h-screen w-screen items-center justify-center bg-background"
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      <div className="flex flex-col items-center">
        <img src={logoImage} alt="logo" className="mb-5 w-14" />
        <div
          className={cn(
            "h-7 w-7 animate-spin rounded-full border-[3px] border-muted",
            isError ? "border-t-destructive" : "border-t-primary",
          )}
        />
        <span
          className={cn(
            "mt-4 text-[13px] tracking-wide",
            isError ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {status}
        </span>
      </div>
    </div>
  )
}
