import * as React from "react"
import {
  IconX,
  IconMinimize,
  IconMaximize,
  IconMinus,
} from "@tabler/icons-react"
import logoSvg from "@/assets/logo.png"
import { UpdatePill } from "@/components/common/app-updater"
import { cn } from "@workspace/ui/lib/utils"

interface AppTitlebarProps {
  title?: string
}

function isElectron() {
  return typeof window !== "undefined" && window.electronApi?.isElectron
}

export function AppTitlebar({ title = "数字员工" }: AppTitlebarProps) {
  const [isMaximized, setIsMaximized] = React.useState(false)
  const [isMac, setIsMac] = React.useState(false)

  React.useEffect(() => {
    if (!isElectron()) return

    void window.electronApi?.getPlatform().then((p) => {
      setIsMac(!!p?.isMac)
    })
  }, [])

  React.useEffect(() => {
    if (!isElectron()) return

    const checkStatus = async () => {
      const result = await window.electronApi?.isMaximized()
      setIsMaximized(!!result)
    }

    checkStatus()

    const handleResize = () => checkStatus()
    window.addEventListener("resize", handleResize)
    return () => window.removeEventListener("resize", handleResize)
  }, [])

  if (!isElectron()) return null

  const handleMinimize = () => window.electronApi?.minimizeWindow()
  const handleMaximize = () => {
    window.electronApi?.maximizeWindow()
    setTimeout(async () => {
      const result = await window.electronApi?.isMaximized()
      setIsMaximized(!!result)
    }, 100)
  }
  const handleClose = () => window.electronApi?.closeWindow()

  return (
    <div
      className={cn(
        "relative flex h-9 shrink-0 items-center border-b border-border/50 bg-background select-none",
        !isMac && "justify-between"
      )}
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      onDoubleClick={isMac ? undefined : handleMaximize}
    >
      {isMac ? (
        <>
          <div
            className="pointer-events-none absolute inset-0 flex items-center justify-center"
            aria-hidden
          >
            <div className="flex items-center gap-2">
              <img src={logoSvg} alt="" className="w-4" />
              <span className="text-xs text-muted-foreground">{title}</span>
            </div>
          </div>
          <div className="h-full w-[76px] shrink-0" aria-hidden />
        </>
      ) : (
        <div className="flex h-full items-center gap-2 px-3">
          <img src={logoSvg} alt="" className="w-4" />
          <span className="text-xs text-muted-foreground">{title}</span>
        </div>
      )}
      <div
        className="ml-auto flex h-full items-center"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        <div className="flex items-center pr-1">
          <UpdatePill />
        </div>
        {!isMac ? (
          <>
            <button
              type="button"
              aria-label="最小化"
              className="inline-flex h-full w-10 items-center justify-center transition-colors outline-none hover:bg-accent"
              onClick={handleMinimize}
            >
              <IconMinus className="size-4" />
            </button>
            <button
              type="button"
              aria-label={isMaximized ? "还原" : "最大化"}
              className="inline-flex h-full w-10 items-center justify-center transition-colors outline-none hover:bg-accent"
              onClick={handleMaximize}
            >
              {isMaximized ? (
                <IconMinimize className="size-4" />
              ) : (
                <IconMaximize className="size-3.5" />
              )}
            </button>
            <button
              type="button"
              aria-label="关闭窗口"
              className="inline-flex h-full w-10 items-center justify-center transition-colors outline-none hover:bg-red-500 hover:text-white"
              onClick={handleClose}
            >
              <IconX className="size-4" />
            </button>
          </>
        ) : null}
      </div>
    </div>
  )
}
