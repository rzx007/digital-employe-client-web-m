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

// 「用户当前真正在看的会话 id」：仅当处于聊天 Tab 时，selectedConversationId 才
// 代表前台会话；在工作台/技能/联系人等 Tab 下它只是上次聊天选中的陈旧残留，不能当
// 前台用——否则总管在工作台委派某员工时，若该员工恰是上次点开的会话，会误判 owner==fg
// 而把人从工作台拽进聊天页并摊开浏览器（见根因：stale selectedConversationId）。
function foregroundConversationId(): string {
  const state = useChatStore.getState()
  if (state.activeTab !== "chat") return ""
  return String(state.selectedConversationId ?? "")
}

export function BrowserConfirmationHost() {
  const openBrowser = useBrowserStore((s) => s.openBrowser)
  const selectedConversationId = useChatStore((s) => s.selectedConversationId)
  const activeTab = useChatStore((s) => s.activeTab)
  const [pending, setPending] =
    React.useState<BrowserConfirmationPayload | null>(null)

  React.useEffect(() => {
    const api = getElectronApi()
    if (!api?.browser?.onConfirmationRequest) return

    // 不要在确认时 openBrowser()：open() 会重新显示并可能重载内嵌浏览器，
    // 在原生合成层盖住本确认弹窗（即遮挡根因）。确认弹窗自带截图预览，无需浏览器面板。
    const unsubRequest = api.browser.onConfirmationRequest((data) => {
      // 非前台会话的确认弹窗不弹在当前界面（否则总管会替员工的浏览器操作背确认）
      const fg = foregroundConversationId()
      const owner = data.conversationId ?? null
      if (owner && fg && owner !== fg) return
      setPending(data)
    })

    const unsubOpen = api.browser.onRequestOpen?.((data) => {
      if (!data.url) return
      const owner = data.conversationId ?? null
      const fg = foregroundConversationId()
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
        const fg = foregroundConversationId()
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

  // 切到某会话、或从工作台等切回聊天 Tab 时，若该前台会话有后台浏览器在跑（之前因
  // 非前台被静默记录），自动重现其最后页面。依赖含 activeTab：仅切了会话 id 不够——
  // 在工作台静默记下后，用户「切回聊天 Tab」时 id 可能没变、只有 activeTab 变。
  React.useEffect(() => {
    const fg = foregroundConversationId()
    if (!fg) return
    useBrowserStore.getState().adoptForeground(fg)
  }, [selectedConversationId, activeTab])

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
