import { createFileRoute } from "@tanstack/react-router"
import logoImage from "@/assets/logo.png"
import { IconX } from "@tabler/icons-react"
import { ActivationForm } from "@/components/activation/activation-form"
import { isElectron, withElectronApi } from "@/lib/electron/host"

export const Route = createFileRoute("/activation")({
  component: ActivationPage,
})

function ActivationPage() {
  const handleClose = () => {
    if (isElectron()) {
      void withElectronApi((api) => api.quitApp())
    }
  }

  return (
    <div
      className="flex h-screen w-screen flex-col bg-background"
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      <div className="flex items-center justify-end p-2">
        <button
          type="button"
          onClick={handleClose}
          className="rounded p-1 text-muted-foreground hover:bg-muted"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          <IconX className="size-4" />
        </button>
      </div>

      <div
        className="flex flex-1 flex-col items-center gap-6 px-8 pb-10"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        <div className="flex flex-col items-center gap-2">
          <img src={logoImage} alt="logo" className="w-12" />
          <h1 className="text-lg font-semibold">应用激活</h1>
          <p className="text-center text-xs text-muted-foreground">
            首次使用需绑定本机设备并输入授权码
          </p>
        </div>

        <ActivationForm className="w-full max-w-sm" />
      </div>
    </div>
  )
}
