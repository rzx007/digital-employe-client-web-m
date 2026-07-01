import * as React from "react"
import {
  IconPlug,
  IconExternalLink,
  IconLoader2,
  IconPackageImport,
  IconTrash,
} from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
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
import { Switch } from "@workspace/ui/components/switch"
import { toast } from "sonner"
import { isElectron, withElectronApi } from "@/lib/electron/host"

interface ExtensionListItem {
  id: string
  version: string
  displayName: string
  hasUi: boolean
  hasService: boolean
  serviceRunning: boolean
  enabled: boolean
}

export function ExtensionsSettings() {
  const [extensions, setExtensions] = React.useState<ExtensionListItem[]>([])
  const [loading, setLoading] = React.useState(true)
  const [deleteTarget, setDeleteTarget] =
    React.useState<ExtensionListItem | null>(null)
  const [deleting, setDeleting] = React.useState(false)
  const [openingId, setOpeningId] = React.useState<string | null>(null)

  const refresh = React.useCallback(async () => {
    if (!isElectron()) {
      setLoading(false)
      return
    }
    const list = await withElectronApi((api) => api.listExtensions(), {
      fallback: [],
    })
    setExtensions(list ?? [])
    setLoading(false)
  }, [])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  const handleToggle = async (id: string, enabled: boolean) => {
    setExtensions((prev) =>
      prev.map((ext) => (ext.id === id ? { ...ext, enabled } : ext))
    )
    await withElectronApi((api) => api.setExtensionEnabled(id, enabled), {
      onError: (error) => {
        const message = error instanceof Error ? error.message : "操作失败"
        toast.error(message)
        void refresh()
      },
    })
    void refresh()
  }

  const handleOpen = async (id: string) => {
    setOpeningId(id)
    await withElectronApi((api) => api.openExtension(id), {
      onError: (error) => {
        const message = error instanceof Error ? error.message : "打开插件失败"
        toast.error(message)
      },
    })
    setOpeningId(null)
  }

  const handleInstall = async () => {
    const result = await withElectronApi(
      (api) => api.installExtensionFromZip(),
      {
        onError: (error) => {
          const message = error instanceof Error ? error.message : "安装失败"
          if (message !== "Install cancelled") {
            toast.error(message)
          }
        },
      }
    )
    if (result?.extensionId) {
      toast.success(`已安装插件：${result.extensionId}`)
      void refresh()
    }
  }

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    const id = deleteTarget.id
    const name = deleteTarget.displayName
    let failed = false
    await withElectronApi((api) => api.uninstallExtension(id), {
      onError: (error) => {
        failed = true
        const message = error instanceof Error ? error.message : "删除失败"
        toast.error(message)
      },
    })
    setDeleting(false)
    if (!failed) {
      setDeleteTarget(null)
      toast.success(`已删除插件：${name}`)
      void refresh()
    }
  }

  if (!isElectron()) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>插件</CardTitle>
          <CardDescription>插件功能仅在桌面客户端可用。</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">插件</h1>
        <p className="text-sm text-muted-foreground">
          将插件 zip 安装到扩展目录，或手动解压到{" "}
          <code className="text-xs">
            ~/.boban-staff/extensions/&lt;id&gt;/
          </code>
          。manifest 为{" "}
          <code className="text-xs">digital-employee.extension.json</code>
          ；可有独立 UI、本地服务，或二者组合。请仅安装来源可信的包。
        </p>
        <Button
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={() => void handleInstall()}
        >
          <IconPackageImport className="size-4" />从 zip 安装…
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <IconPlug className="size-5" />
            已安装
          </CardTitle>
          <CardDescription>
            启用后：有 UI 的可打开窗口；仅后台服务的插件会在启用时自动启动进程。
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">加载中…</p>
          ) : extensions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              未发现插件。可将示例包复制到扩展目录后刷新。
            </p>
          ) : (
            <ul className="divide-y">
              {extensions.map((ext) => (
                <li
                  key={ext.id}
                  className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{ext.displayName}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {ext.id} · v{ext.version}
                      {!ext.hasUi && ext.hasService ? " · 后台服务" : ""}
                    </p>
                    {!ext.hasUi && ext.hasService && ext.enabled ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {ext.serviceRunning ? "服务运行中" : "服务已停止"}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Switch
                      checked={ext.enabled}
                      onCheckedChange={(checked) =>
                        void handleToggle(ext.id, checked)
                      }
                      aria-label={`启用 ${ext.displayName}`}
                    />
                    {ext.hasUi ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!ext.enabled || openingId != null}
                        onClick={() => void handleOpen(ext.id)}
                      >
                        {openingId === ext.id ? (
                          <>
                            <IconLoader2 className="size-4 animate-spin" />
                            启动中…
                          </>
                        ) : (
                          <>
                            <IconExternalLink className="size-4" />
                            打开
                          </>
                        )}
                      </Button>
                    ) : null}
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setDeleteTarget(ext)}
                      aria-label={`删除 ${ext.displayName}`}
                    >
                      <IconTrash className="size-4" />
                      删除
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="mt-4"
            onClick={() => void refresh()}
          >
            刷新列表
          </Button>

          <div className="mt-6 rounded-lg border border-border p-4">
            <p className="text-sm font-medium">宿主事件（调试）</p>
            <p className="mt-1 text-xs text-muted-foreground">
              向已打开且含 host.events 的插件窗推送测试事件；headless 插件会在
              service 运行中收到 POST。
            </p>
            <Button
              variant="secondary"
              size="sm"
              className="mt-3"
              onClick={() => {
                void withElectronApi(
                  (api) =>
                    api.emitExtensionHostEvent("extension.test", {
                      message: "hello from host",
                    }),
                  {
                    onError: (error) => {
                      toast.error(
                        error instanceof Error ? error.message : "发送失败"
                      )
                    },
                  }
                )
              }}
            >
              发送测试事件
            </Button>
          </div>
        </CardContent>
      </Card>

      <AlertDialog
        open={deleteTarget != null}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除插件</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除「{deleteTarget?.displayName}」（
              <code className="text-xs">{deleteTarget?.id}</code>
              ）吗？将关闭窗口、停止服务并删除扩展目录，此操作不可恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleting}
              onClick={() => void handleDeleteConfirm()}
            >
              {deleting ? "删除中…" : "删除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
