import * as React from "react"
import {
  IconArrowUp,
  IconCircleCheck,
  IconDownload,
  IconLoader2,
  IconRefresh,
} from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { useAppUpdater } from "@/components/common/use-app-updater"

export function UpdatePill() {
  const { state, handleClick } = useAppUpdater()

  if (!window.electronApi?.isElectron) return null

  if (
    state.status === "idle" ||
    state.status === "checking" ||
    state.status === "error"
  ) {
    return null
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      className={cn(
        "flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium transition-all duration-300 animate-in fade-in slide-in-from-right-2",
        state.status === "available" &&
        "cursor-pointer bg-primary/15 text-primary hover:bg-primary/25",
        state.status === "downloading" &&
        "cursor-default bg-primary/80 text-white",
        state.status === "downloaded" &&
        "cursor-pointer bg-primary/80 text-white hover:bg-primary"
      )}
    >
      {state.status === "available" && (
        <>
          <IconArrowUp className="size-3.5" />
          <span>新版本</span>
        </>
      )}
      {state.status === "downloading" && (
        <>
          <IconLoader2 className="size-3.5 animate-spin" />
          <span>下载中 {state.progress}%</span>
        </>
      )}
      {state.status === "downloaded" && (
        <>
          <IconCircleCheck className="size-3.5" />
          <span>点击重启安装</span>
        </>
      )}
    </button>
  )
}

export function UpdateButton() {
  const { state, handleClick } = useAppUpdater()

  if (!window.electronApi?.isElectron) return null

  const getConfig = () => {
    switch (state.status) {
      case "checking":
        return {
          text: "检查更新中...",
          icon: IconRefresh,
          loading: true,
        }
      case "available":
        return {
          text: `发现新版本 v${state.newVersion}`,
          icon: IconDownload,
          loading: false,
        }
      case "downloading":
        return {
          text: `下载中 ${state.progress}%`,
          icon: IconLoader2,
          loading: true,
        }
      case "downloaded":
        return {
          text: "点击重启安装",
          icon: IconCircleCheck,
          loading: false,
        }
      case "error":
        return {
          text: state.errorMessage || "检查更新失败",
          icon: IconRefresh,
          loading: false,
        }
      default:
        return {
          text: "检查更新",
          icon: IconRefresh,
          loading: false,
        }
    }
  }

  const config = getConfig()

  return (
    <Button
      className="w-full"
      variant={state.status === "error" ? "destructive" : "outline"}
      disabled={
        state.status === "checking" || state.status === "downloading"
      }
      onClick={handleClick}
    >
      {config.loading ? (
        <config.icon className="mr-2 size-4 animate-spin" />
      ) : (
        <config.icon className="mr-2 size-4" />
      )}
      {config.text}
    </Button>
  )
}
