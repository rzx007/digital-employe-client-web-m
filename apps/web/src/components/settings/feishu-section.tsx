import * as React from "react"
import { toast } from "sonner"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Input } from "@workspace/ui/components/input"
import { Switch } from "@workspace/ui/components/switch"
import { Label } from "@workspace/ui/components/label"
import { Textarea } from "@workspace/ui/components/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { cn } from "@workspace/ui/lib/utils"
import { getConfigKv, setManyConfigKv } from "@/api/config-kv"
import { fetchQrcode, pollQrcodeStatus } from "@/api/feishu-channel"
import { appendOpenId } from "@/lib/feishu-whitelist"

const POLL_INTERVAL_MS = 2000
const POLL_TIMEOUT_MS = 5 * 60 * 1000
const MAX_CONSECUTIVE_FAILURES = 3

type QrcodeState =
  | "idle"
  | "loading"
  | "waiting"
  | "expired"
  | "fail"

export function FeishuSection() {
  const [enabled, setEnabled] = React.useState(false)
  const [appId, setAppId] = React.useState("")
  const [appSecret, setAppSecret] = React.useState("")
  const [whitelist, setWhitelist] = React.useState("")
  const [saving, setSaving] = React.useState(false)

  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [qrImg, setQrImg] = React.useState("")
  const [qrState, setQrState] = React.useState<QrcodeState>("idle")
  const [statusText, setStatusText] = React.useState("")

  const intervalRef = React.useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPolling = React.useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }, [])

  // 初始回显
  React.useEffect(() => {
    void Promise.all([
      getConfigKv("FEISHU_CHANNEL_ENABLED"),
      getConfigKv("FEISHU_CHANNEL_APP_ID"),
      getConfigKv("FEISHU_CHANNEL_APP_SECRET"),
      getConfigKv("FEISHU_WHITELIST_OPEN_IDS"),
    ])
      .then(([enabledKv, appIdKv, appSecretKv, whitelistKv]) => {
        setEnabled(enabledKv?.config_value === "1")
        setAppId(appIdKv?.config_value ?? "")
        setAppSecret(appSecretKv?.config_value ?? "")
        setWhitelist(whitelistKv?.config_value ?? "")
      })
      .catch(() => {})
  }, [])

  // 卸载时清理轮询
  React.useEffect(() => {
    return () => {
      stopPolling()
    }
  }, [stopPolling])

  const handleSave = async () => {
    setSaving(true)
    try {
      await setManyConfigKv([
        { key: "FEISHU_CHANNEL_ENABLED", value: enabled ? "1" : "0" },
        { key: "FEISHU_CHANNEL_APP_ID", value: appId },
        { key: "FEISHU_CHANNEL_APP_SECRET", value: appSecret },
        { key: "FEISHU_WHITELIST_OPEN_IDS", value: whitelist },
      ])
      toast.success("已保存")
    } catch {
      toast.error("保存失败")
    } finally {
      setSaving(false)
    }
  }

  const startPolling = React.useCallback(
    (token: string) => {
      stopPolling()
      const startedAt = Date.now()
      let failCount = 0
      intervalRef.current = setInterval(() => {
        if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
          stopPolling()
          setQrState("expired")
          setStatusText("二维码已过期，请重新获取")
          return
        }
        void pollQrcodeStatus(token)
          .then((resp) => {
            failCount = 0
            const cred = resp.credentials ?? {}
            if (resp.status === "waiting") {
              return
            }
            if (resp.status === "success") {
              stopPolling()
              setAppId(cred.app_id ?? "")
              setAppSecret(cred.app_secret ?? "")
              setWhitelist((prev) => appendOpenId(prev, cred.open_id ?? ""))
              toast.success("已获取凭证，请点保存")
              setDialogOpen(false)
              return
            }
            if (resp.status === "expired") {
              stopPolling()
              setQrState("expired")
              setStatusText("二维码已过期，请重新获取")
              return
            }
            // fail
            stopPolling()
            setQrState("fail")
            setStatusText(cred.fail_reason ?? "授权失败")
          })
          .catch(() => {
            failCount += 1
            if (failCount >= MAX_CONSECUTIVE_FAILURES) {
              stopPolling()
              setQrState("fail")
              setStatusText("网络异常")
            }
          })
      }, POLL_INTERVAL_MS)
    },
    [stopPolling]
  )

  const openQrcodeDialog = async () => {
    setDialogOpen(true)
    setQrState("loading")
    setQrImg("")
    setStatusText("正在获取二维码...")
    try {
      const { qrcode_img, poll_token } = await fetchQrcode("feishu")
      setQrImg(qrcode_img)
      setQrState("waiting")
      setStatusText("请用飞书扫码授权")
      startPolling(poll_token)
    } catch {
      setQrState("fail")
      setStatusText("获取二维码失败，请重试")
    }
  }

  const handleDialogOpenChange = (open: boolean) => {
    if (!open) {
      stopPolling()
    }
    setDialogOpen(open)
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>飞书</CardTitle>
        <CardDescription>
          配置飞书机器人凭证与白名单，启用后可通过飞书与数字员工对话
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="feishu-app-id">App ID</Label>
          <Input
            id="feishu-app-id"
            value={appId}
            placeholder="cli_xxxxxxxx"
            onChange={(e) => setAppId(e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="feishu-app-secret">App Secret</Label>
          <Input
            id="feishu-app-secret"
            type="password"
            value={appSecret}
            placeholder="••••••••"
            onChange={(e) => setAppSecret(e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="feishu-whitelist">白名单 Open ID（逗号分隔）</Label>
          <Textarea
            id="feishu-whitelist"
            value={whitelist}
            placeholder="ou_xxx,ou_yyy"
            onChange={(e) => setWhitelist(e.target.value)}
          />
        </div>

        <div className="flex items-center justify-between border-t pt-4">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium">已启用</span>
            <span className="text-xs text-muted-foreground">
              开启后接入飞书渠道
            </span>
          </div>
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t pt-4">
          <Button onClick={() => void handleSave()} disabled={saving}>
            保存
          </Button>
          <Button variant="outline" onClick={() => void openQrcodeDialog()}>
            获取飞书二维码
          </Button>
        </div>
        <span className="text-xs text-muted-foreground">
          保存后需重启应用生效
        </span>
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={handleDialogOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>飞书扫码授权</DialogTitle>
            <DialogDescription>
              使用飞书 App 扫描二维码以自动获取凭证
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center gap-3 py-2">
            {qrImg ? (
              <img
                src={`data:image/png;base64,${qrImg}`}
                alt="飞书二维码"
                className={cn(
                  "size-48 rounded-md border",
                  (qrState === "expired" || qrState === "fail") &&
                    "opacity-40 grayscale"
                )}
              />
            ) : (
              <div className="flex size-48 items-center justify-center rounded-md border text-xs text-muted-foreground">
                {qrState === "loading" ? "加载中..." : "无二维码"}
              </div>
            )}
            <span
              className={cn(
                "text-sm",
                qrState === "fail"
                  ? "text-destructive"
                  : "text-muted-foreground"
              )}
            >
              {statusText}
            </span>
            {(qrState === "expired" || qrState === "fail") && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void openQrcodeDialog()}
              >
                重新获取
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
