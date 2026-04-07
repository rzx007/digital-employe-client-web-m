import { useEffect, useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import logoImage from "@/assets/logo.svg"

export const Route = createFileRoute("/splash")({
  component: SplashPage,
})

function SplashPage() {
  const [status, setStatus] = useState("正在启动服务...")

  useEffect(() => {
    const cleanup = window.electronApi?.onBackendError?.((message) => {
      setStatus(`服务启动失败: ${message}`)
    })
    return () => cleanup?.()
  }, [])

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-[#f9fafb]">
      <div className="flex flex-col items-center">
        <img src={logoImage} alt="logo" className="mb-5 h-12 w-12" />
        <div className="h-7 w-7 animate-spin rounded-full border-[3px] border-gray-200 border-t-blue-500" />
        <span className="mt-4 text-[13px] tracking-wide text-gray-500">
          {status}
        </span>
      </div>
    </div>
  )
}
