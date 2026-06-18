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
import { useChatStore } from "@/stores/chat-store"

export interface BrowserConfirmationPayload {
  id: string
  message: string
  refOrSelector: string
  screenshotBase64?: string
}

export function BrowserConfirmationHost() {
  const openBrowser = useBrowserStore((s) => s.openBrowser)
  const selectedConversationId = useChatStore((s) => s.selectedConversationId)
  const [pending, setPending] =
    React.useState<BrowserConfirmationPayload | null>(null)

  React.useEffect(() => {
    const api = getElectronApi()
    if (!api?.browser?.onConfirmationRequest) return

    // 不要在确认时 openBrowser()：open() 会重新显示并可能重载内嵌浏览器，
    // 在原生合成层盖住本确认弹窗（即遮挡根因）。确认弹窗自带截图预览，无需浏览器面板。
    const unsubRequest = api.browser.onConfirmationRequest((data) => {
      // 非前台会话的确认弹窗不弹在当前界面（否则总管会替员工的浏览器操作背确认）
      const fg = String(useChatStore.getState().selectedConversationId ?? "")
      const owner = data.conversationId ?? null
      if (owner && fg && owner !== fg) return
      setPending(data)
    })

    const unsubOpen = api.browser.onRequestOpen?.((data) => {
      if (!data.url) return
      const owner = data.conversationId ?? null
      const fg = String(useChatStore.getState().selectedConversationId ?? "")
      const store = useBrowserStore.getState()
      // 无归属（default/调试路径）→ 维持旧的无条件摊开
      if (!owner) {
        store.openBrowser(data.url)
        store.setActiveBrowserConversationId(null)
        return
      }
      // 归属 == 前台 → 摊开并记归属；否则静默记后台，不渲染
      if (owner === fg) {
        store.openBrowser(data.url)
        store.setActiveBrowserConversationId(owner)
        store.clearBackground(owner)
      } else {
        store.noteBackgroundOpen(owner, data.url)
      }
    })

    // HTTP 侧 browserctl close：bridge 已销毁内嵌浏览器，这里仅收起右栏 UI
    const unsubClose = api.browser.onRequestClose?.((data) => {
      const owner = data?.conversationId ?? null
      const store = useBrowserStore.getState()
      // 关的是后台会话 → 只清它的后台标记，不动当前界面
      if (owner) {
        const fg = String(useChatStore.getState().selectedConversationId ?? "")
        if (owner !== fg) {
          store.clearBackground(owner)
          return
        }
      }
      store.reset()
    })

    return () => {
      unsubRequest()
      unsubOpen?.()
      unsubClose?.()
    }
  }, [openBrowser])

  // 切到某会话时，若它有后台浏览器在跑（之前因非前台被静默记录），自动重现其最后页面。
  React.useEffect(() => {
    const fg = String(selectedConversationId ?? "")
    if (!fg) return
    useBrowserStore.getState().adoptForeground(fg)
  }, [selectedConversationId])

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
