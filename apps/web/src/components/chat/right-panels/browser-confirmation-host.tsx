import * as React from "react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog"

import { getElectronApi } from "@/lib/electron/host"
import { useBrowserStore } from "@/stores/browser-store"

export interface BrowserConfirmationPayload {
  id: string
  message: string
  refOrSelector: string
  screenshotBase64?: string
}

export function BrowserConfirmationHost() {
  const openBrowser = useBrowserStore((s) => s.openBrowser)
  const [pending, setPending] =
    React.useState<BrowserConfirmationPayload | null>(null)

  React.useEffect(() => {
    const api = getElectronApi()
    if (!api?.browser?.onConfirmationRequest) return

    const unsubRequest = api.browser.onConfirmationRequest((data) => {
      openBrowser(
        useBrowserStore.getState().currentUrl || "https://www.baidu.com"
      )
      setPending(data)
    })

    const unsubOpen = api.browser.onRequestOpen?.((data) => {
      if (data.url) openBrowser(data.url)
    })

    // HTTP 侧 browserctl close：bridge 已销毁内嵌浏览器，这里仅收起右栏 UI
    const unsubClose = api.browser.onRequestClose?.(() => {
      useBrowserStore.getState().reset()
    })

    return () => {
      unsubRequest()
      unsubOpen?.()
      unsubClose?.()
    }
  }, [openBrowser])

  const handleResolve = (approved: boolean) => {
    if (!pending) return
    const api = getElectronApi()
    void api?.browser?.resolveConfirmation(pending.id, approved)
    setPending(null)
  }

  return (
    <AlertDialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open) handleResolve(false)
      }}
    >
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>确认浏览器操作</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-sm text-muted-foreground">
              <p>{pending?.message}</p>
              {pending?.refOrSelector && (
                <p className="font-mono text-xs text-foreground/80">
                  目标: {pending.refOrSelector}
                </p>
              )}
              {pending?.screenshotBase64 && (
                <img
                  src={`data:image/png;base64,${pending.screenshotBase64}`}
                  alt="页面预览"
                  className="max-h-40 w-full rounded-md border object-contain bg-muted"
                />
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => handleResolve(false)}>
            取消
          </AlertDialogCancel>
          <AlertDialogAction onClick={() => handleResolve(true)}>
            确认执行
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
