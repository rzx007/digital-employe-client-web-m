import * as React from "react"
import { IconPlug, IconExternalLink } from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
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
      prev.map((ext) => (ext.id === id ? { ...ext, enabled } : ext)),
    )
    await withElectronApi((api) => api.setExtensionEnabled(id, enabled), {
      onError: (error) => {
        const message =
          error instanceof Error ? error.message : "操作失败"
        toast.error(message)
        void refresh()
      },
    })
    void refresh()
  }

  const handleOpen = (id: string) => {
    void withElectronApi((api) => api.openExtension(id), {
      onError: (error) => {
        const message =
          error instanceof Error ? error.message : "打开插件失败"
        toast.error(message)
      },
    })
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
        <p className="text-muted-foreground text-sm">
          将插件目录解压到{" "}
          <code className="text-xs">
            ~/.digital-employee/extensions/&lt;id&gt;/
          </code>
          ，内含{" "}
          <code className="text-xs">digital-employee.extension.json</code>
          ；可有独立 UI、本地服务，或二者组合。
        </p>
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
            <p className="text-muted-foreground text-sm">加载中…</p>
          ) : extensions.length === 0 ? (
            <p className="text-muted-foreground text-sm">
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
                    <p className="text-muted-foreground truncate text-xs">
                      {ext.id} · v{ext.version}
                      {!ext.hasUi && ext.hasService ? " · 后台服务" : ""}
                    </p>
                    {!ext.hasUi && ext.hasService && ext.enabled ? (
                      <p className="text-muted-foreground mt-1 text-xs">
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
                        disabled={!ext.enabled}
                        onClick={() => handleOpen(ext.id)}
                      >
                        <IconExternalLink className="size-4" />
                        打开
                      </Button>
                    ) : null}
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
        </CardContent>
      </Card>
    </div>
  )
}
