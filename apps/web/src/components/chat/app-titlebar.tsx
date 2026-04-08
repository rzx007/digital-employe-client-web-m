import * as React from "react"
import {
  IconX,
  IconMinus,
  IconSquare,
  IconLayoutRows,
} from "@tabler/icons-react"
import logoSvg from "@/assets/logo.svg"

interface AppTitlebarProps {
  title?: string
}

function isElectron() {
  return typeof window !== "undefined" && window.electronApi?.isElectron
}

export function AppTitlebar({ title = "数字员工" }: AppTitlebarProps) {
  const [isMaximized, setIsMaximized] = React.useState(false)

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
      className="flex h-9 shrink-0 items-center bg-transparent select-none"
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      onDoubleClick={handleMaximize}
    >
      <div className="flex flex-1 items-center gap-2 pl-3">
        <img src={logoSvg} alt="" className="size-4" />
        <span className="text-xs text-muted-foreground">{title}</span>
      </div>
      <div
        className="flex h-full items-center"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        <button
          type="button"
          className="inline-flex h-full w-10 items-center justify-center transition-colors outline-none hover:bg-accent"
          onClick={handleMinimize}
        >
          <IconMinus className="size-4" />
        </button>
        <button
          type="button"
          className="inline-flex h-full w-10 items-center justify-center transition-colors outline-none hover:bg-accent"
          onClick={handleMaximize}
        >
          {isMaximized ? (
            <IconLayoutRows className="size-4" />
          ) : (
            <IconSquare className="size-3.5" />
          )}
        </button>
        <button
          type="button"
          className="inline-flex h-full w-10 items-center justify-center transition-colors outline-none hover:bg-red-500 hover:text-white"
          onClick={handleClose}
        >
          <IconX className="size-4" />
        </button>
      </div>
    </div>
  )
}
