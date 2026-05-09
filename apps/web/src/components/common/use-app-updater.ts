import { useCallback, useEffect, useRef, useState } from "react"

type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "downloaded"
  | "error"
  | "up-to-date"

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

interface UseAppUpdaterOptions {
  autoCheck?: boolean
  onNotAvailable?: () => void
  onError?: (message: string) => void
}

type Listener = (state: UpdateState) => void
const listeners = new Set<Listener>()
let sharedState: UpdateState = { ...initialState }

function notifyAll() {
  listeners.forEach((fn) => fn(sharedState))
}

let ipcSubscribed = false
let unsubFns: (() => void)[] = []

let resetTimer: ReturnType<typeof setTimeout> | null = null

function scheduleReset() {
  if (resetTimer) globalThis.clearTimeout(resetTimer)
  resetTimer = setTimeout(() => {
    if (sharedState.status === "up-to-date" || sharedState.status === "error") {
      sharedState = { ...initialState }
      notifyAll()
    }
  }, 4_000)
}

function ensureIpcSubscription() {
  if (ipcSubscribed || !window.electronApi?.isElectron) return
  ipcSubscribed = true

  const unsubAvailable = window.electronApi.onUpdateAvailable((info) => {
    sharedState = { ...sharedState, status: "available", newVersion: info.newVersion }
    notifyAll()
  })

  const unsubNotAvailable = window.electronApi.onUpdateNotAvailable(() => {
    sharedState = { ...sharedState, status: "up-to-date" }
    scheduleReset()
    notifyAll()
  })

  const unsubProgress = window.electronApi.onDownloadProgress((info) => {
    sharedState = { ...sharedState, status: "downloading", progress: Math.floor(info.percent) }
    notifyAll()
  })

  const unsubDownloaded = window.electronApi.onUpdateDownloaded(() => {
    sharedState = { ...sharedState, status: "downloaded" }
    notifyAll()
  })

  const unsubError = window.electronApi.onUpdateError((info) => {
    sharedState = { ...sharedState, status: "error", errorMessage: info.message || "检查更新失败" }
    scheduleReset()
    notifyAll()
  })

  unsubFns = [unsubAvailable, unsubNotAvailable, unsubProgress, unsubDownloaded, unsubError]
}

function teardownIpcSubscription() {
  if (!ipcSubscribed) return
  unsubFns.forEach((fn) => fn())
  unsubFns = []
  ipcSubscribed = false
}

export function useAppUpdater(options?: UseAppUpdaterOptions) {
  const [state, setState] = useState<UpdateState>(sharedState)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const optionsRef = useRef(options)
  const prevStatusRef = useRef<UpdateStatus>(state.status)
  const stateRef = useRef(state)

  useEffect(() => {
    optionsRef.current = options
  })

  useEffect(() => {
    stateRef.current = state
  })

  const cancelTimeout = useCallback(() => {
    if (timeoutRef.current) {
      globalThis.clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }, [])

  const scheduleTimeout = useCallback(() => {
    cancelTimeout()
    timeoutRef.current = setTimeout(() => {
      if (sharedState.status === "checking") {
        const msg = "检查更新超时"
        sharedState = { ...sharedState, status: "error", errorMessage: msg }
        optionsRef.current?.onError?.(msg)
        scheduleReset()
        notifyAll()
      }
    }, 15_000)
  }, [cancelTimeout])

  const checkForUpdates = useCallback(async () => {
    if (!window.electronApi?.isElectron) return
    sharedState = { ...sharedState, status: "checking", errorMessage: "" }
    notifyAll()
    scheduleTimeout()
    try {
      await window.electronApi.checkUpdate()
    } catch {
      cancelTimeout()
      sharedState = { ...sharedState, status: "error", errorMessage: "检查更新失败" }
      scheduleReset()
      notifyAll()
    }
  }, [scheduleTimeout, cancelTimeout])

  const downloadUpdate = useCallback(async () => {
    if (!window.electronApi?.isElectron) return
    sharedState = { ...sharedState, status: "downloading", progress: 0 }
    notifyAll()
    try {
      await window.electronApi.startDownloadUpdate()
    } catch {
      sharedState = { ...sharedState, status: "error", errorMessage: "下载更新失败" }
      scheduleReset()
      notifyAll()
    }
  }, [])

  const installUpdate = useCallback(() => {
    if (!window.electronApi?.isElectron) return
    window.electronApi.quitAndInstall()
  }, [])

  useEffect(() => {
    ensureIpcSubscription()

    const listener: Listener = (s) => {
      cancelTimeout()
      setState(s)
    }
    listeners.add(listener)

    return () => {
      listeners.delete(listener)
      cancelTimeout()
      if (listeners.size === 0) {
        teardownIpcSubscription()
      }
    }
  }, [cancelTimeout])

  useEffect(() => {
    if (!window.electronApi?.isElectron) return
    if (!options?.autoCheck) return

    const autoCheck = async () => {
      const enabled = await window?.electronApi?.getAutoUpdate?.()
      if (enabled) {
        checkForUpdates()
      }
    }
    autoCheck()
  }, [checkForUpdates, options?.autoCheck])

  useEffect(() => {
    const prev = prevStatusRef.current
    prevStatusRef.current = state.status

    if (prev === state.status) return

    if (state.status === "up-to-date") {
      optionsRef.current?.onNotAvailable?.()
    }
    if (state.status === "error" && state.errorMessage) {
      optionsRef.current?.onError?.(state.errorMessage)
    }
  }, [state.status, state.errorMessage])

  const handleClick = useCallback(() => {
    switch (stateRef.current.status) {
      case "available":
        return downloadUpdate()
      case "downloaded":
        return installUpdate()
      default:
        return checkForUpdates()
    }
  }, [checkForUpdates, downloadUpdate, installUpdate])

  return { state, checkForUpdates, downloadUpdate, installUpdate, handleClick }
}
