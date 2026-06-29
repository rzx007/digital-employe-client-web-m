import * as React from "react"
import {
  IconLoader2,
  IconShieldCheck,
  IconShieldQuestion,
  IconShieldX,
} from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { useEndpointStore } from "@/stores/endpoint-store"
import { toast } from "sonner"

interface EndpointConfigProps {
  onCancel: () => void
  onSaved: () => void
  /** 验证成功并已写入 KV 后回调（同步业务 API baseURL、刷新注册部门树等） */
  onKvPersisted?: () => void
  isElectron?: boolean
}

type ValidateStatus = "idle" | "loading" | "success" | "error"

export function EndpointConfig({
  onCancel,
  onSaved,
  onKvPersisted,
  isElectron = false,
}: EndpointConfigProps) {
  const {
    protocol,
    ip,
    port,
    validated,
    setProtocol,
    setIp,
    setPort,
    setValidated,
    validateEndpoint,
    saveEndpoint,
    loadEndpoint,
  } = useEndpointStore()

  const [status, setStatus] = React.useState<ValidateStatus>("idle")

  React.useEffect(() => {
    setValidated(false)
    setStatus("idle")
  }, [setValidated])

  React.useEffect(() => {
    loadEndpoint()
  }, [loadEndpoint])

  const handleValidate = async (e: React.FormEvent) => {
    e.preventDefault()
    setStatus("loading")
    const ok = await validateEndpoint()
    if (!ok) {
      setStatus("error")
      setTimeout(() => setStatus("idle"), 2000)
      return
    }
    try {
      await saveEndpoint()
      setStatus("success")
      // toast.success("通讯地址验证成功，配置已保存")
      onKvPersisted?.()
    } catch (err) {
      setStatus("error")
      toast.error(
        err instanceof Error ? err.message : "保存通讯配置失败，请重试"
      )
      setTimeout(() => setStatus("idle"), 2000)
    }
  }

  const handleSave = async () => {
    await saveEndpoint()
    onSaved()
  }

  return (
    <div
      className="box-border px-0"
      style={
        isElectron
          ? ({ WebkitAppRegion: "no-drag" } as React.CSSProperties)
          : undefined
      }
    >
      <div
        className={cn(
          "mx-auto w-full",
          isElectron ? "mt-5 w-[95%]" : "max-w-md"
        )}
      >
        <form onSubmit={handleValidate} className="space-y-4">
          <div>
            <label className="lgn-label">协议</label>
            <Select value={protocol} onValueChange={setProtocol}>
              <SelectTrigger className="h-10 w-full rounded-[9px] border-[#E4E7F0] bg-white px-[13px] text-[13.5px] text-[#2A2E3C]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="http://">http</SelectItem>
                <SelectItem value="https://">https</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="lgn-label">
              通讯地址
              <em className="ml-1 text-xs font-normal text-[#9298AB]">
                (ip或域名)
              </em>
            </label>
            <input
              className="lgn-field"
              placeholder="请输入IP地址"
              value={ip}
              onChange={(e) => setIp(e.target.value)}
            />
          </div>

          <div>
            <label className="lgn-label">端口</label>
            <input
              className="lgn-field"
              type="number"
              placeholder="请输入端口"
              value={port}
              onChange={(e) => setPort(Number(e.target.value))}
            />
          </div>

          <div className="flex w-full justify-end gap-2 pt-1">
            {status === "success" || validated ? (
              <Button variant="outline" onClick={handleSave}>
                <IconShieldCheck className="mr-1 size-5 text-green-500" />
                确定
              </Button>
            ) : (
              <Button
                type="submit"
                disabled={status === "loading"}
                variant={status === "error" ? "destructive" : "default"}
              >
                {status === "loading" ? (
                  <IconLoader2 className="mr-1 size-5 animate-spin" />
                ) : status === "error" ? (
                  <IconShieldX className="mr-1 size-5" />
                ) : (
                  <IconShieldQuestion className="mr-1 size-5" />
                )}
                {status === "error" ? "异常" : "验证"}
              </Button>
            )}
            <Button variant="ghost" type="button" onClick={onCancel}>
              取消
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
