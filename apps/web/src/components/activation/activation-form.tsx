import * as React from "react"
import { IconCopy, IconCheck, IconLoader2 } from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import { Label } from "@workspace/ui/components/label"
import { cn } from "@workspace/ui/lib/utils"
import { toast } from "sonner"
import { useDeviceCode } from "@/lib/activation/use-activation"
import { activateLicense } from "@/api/activation"
import { isElectron, withElectronApi } from "@/lib/electron/host"

interface ActivationFormProps {
  /** 激活成功后回调（about 页可传刷新；激活窗默认通知主进程切窗） */
  onActivated?: () => void
  className?: string
}

export function ActivationForm({ onActivated, className }: ActivationFormProps) {
  const { data: deviceData, isLoading: deviceLoading } = useDeviceCode()
  const deviceCode = deviceData?.data?.device_code ?? ""

  const [license, setLicense] = React.useState("")
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [copied, setCopied] = React.useState(false)

  const handleCopy = async () => {
    if (!deviceCode) return
    try {
      await navigator.clipboard.writeText(deviceCode)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error("复制失败，请手动选择")
    }
  }

  const handleActivate = async () => {
    const code = license.trim()
    if (!code) {
      setError("请输入授权码")
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const res = await activateLicense(code)
      if (res.code !== 200) {
        setError(res.msg || "激活失败")
        return
      }
      toast.success("激活成功")
      if (onActivated) {
        onActivated()
      } else if (isElectron()) {
        await withElectronApi((api) => api.activationSuccess())
      }
    } catch {
      setError("激活请求失败，请稍后重试")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className={cn("flex flex-col gap-5", className)}>
      <div className="flex flex-col gap-2">
        <Label className="text-sm text-muted-foreground">设备码</Label>
        <div className="flex items-center gap-2">
          <code className="flex-1 truncate rounded-md border bg-muted px-3 py-2 font-mono text-sm">
            {deviceLoading ? "读取中…" : deviceCode || "无法获取"}
          </code>
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => void handleCopy()}
            disabled={!deviceCode}
          >
            {copied ? (
              <IconCheck className="size-4" />
            ) : (
              <IconCopy className="size-4" />
            )}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          请将设备码发送给管理员，获取授权码后填入下方激活。
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="license-code" className="text-sm text-muted-foreground">
          授权码
        </Label>
        <textarea
          id="license-code"
          value={license}
          onChange={(e) => setLicense(e.target.value)}
          rows={4}
          placeholder="粘贴管理员提供的授权码"
          className="resize-none rounded-md border bg-background px-3 py-2 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>

      <Button
        type="button"
        onClick={() => void handleActivate()}
        disabled={submitting}
      >
        {submitting && <IconLoader2 className="mr-2 size-4 animate-spin" />}
        {submitting ? "激活中…" : "激活"}
      </Button>
    </div>
  )
}
