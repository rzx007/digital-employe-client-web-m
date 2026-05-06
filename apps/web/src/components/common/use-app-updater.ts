import * as React from "react"

type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "downloaded"
  | "error"

interface UpdateState {
  status: UpdateStatus
  progress: number
  newVersion: string
  errorMessage: string
}

const initialState: UpdateState = {
  status: "idle",
  progress: 0,
  newVersion: "",
  errorMessage: "",
}

export function useAppUpdater() {
  const [state, setState] = React.useState<UpdateState>(initialState)

  const checkForUpdates = React.useCallback(async () => {
    if (!window.electronApi?.isElectron) return
    setState((s) => ({ ...s, status: "checking", errorMessage: "" }))

    const timer = setTimeout(() => {
      setState((s) => {
        if (s.status === "checking") {
          return { ...s, status: "error", errorMessage: "检查更新超时" }
        }
        return s
      })
    }, 15_000)

    try {
      await window.electronApi.checkUpdate()
    } catch {
      setState((s) => ({
        ...s,
        status: "error",
        errorMessage: "检查更新失败",
      }))
    } finally {
      clearTimeout(timer)
    }
  }, [])

  const downloadUpdate = React.useCallback(async () => {
    if (!window.electronApi?.isElectron) return
    setState((s) => ({ ...s, status: "downloading", progress: 0 }))
    try {
      await window.electronApi.startDownloadUpdate()
    } catch {
      setState((s) => ({
        ...s,
        status: "error",
        errorMessage: "下载更新失败",
      }))
    }
  }, [])

  const installUpdate = React.useCallback(() => {
    if (!window.electronApi?.isElectron) return
    window.electronApi.quitAndInstall()
  }, [])

  React.useEffect(() => {
    if (!window.electronApi?.isElectron) return

    const unsubAvailable = window.electronApi.onUpdateAvailable((info) => {
      setState((s) => ({
        ...s,
        status: "available",
        newVersion: info.newVersion,
      }))
    })

    const unsubNotAvailable = window.electronApi.onUpdateNotAvailable(() => {
      setState((s) => ({ ...s, status: "idle" }))
    })

    const unsubProgress = window.electronApi.onDownloadProgress((info) => {
      setState((s) => ({
        ...s,
        status: "downloading",
        progress: Math.floor(info.percent),
      }))
    })

    const unsubDownloaded = window.electronApi.onUpdateDownloaded(() => {
      setState((s) => ({ ...s, status: "downloaded" }))
    })

    const unsubError = window.electronApi.onUpdateError((info) => {
      setState((s) => ({
        ...s,
        status: "error",
        errorMessage: info.message,
      }))
    })

    return () => {
      unsubAvailable()
      unsubNotAvailable()
      unsubProgress()
      unsubDownloaded()
      unsubError()
    }
  }, [])

  React.useEffect(() => {
    if (!window.electronApi?.isElectron) return

    const autoCheck = async () => {
      const enabled = await window?.electronApi?.getAutoUpdate?.()
      if (enabled) {
        checkForUpdates()
      }
    }
    autoCheck()
  }, [checkForUpdates])

  const handleClick = React.useCallback(() => {
    switch (state.status) {
      case "available":
        return downloadUpdate()
      case "downloaded":
        return installUpdate()
      case "error":
        return checkForUpdates()
      default:
        return checkForUpdates()
    }
  }, [state.status, checkForUpdates, downloadUpdate, installUpdate])

  return { state, checkForUpdates, downloadUpdate, installUpdate, handleClick }
}
