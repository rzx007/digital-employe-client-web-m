import * as React from "react"
import {
  IconLoader2,
  IconShieldCheck,
  IconShieldQuestion,
  IconCircleX,
  IconShieldX,
} from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { useEndpointStore } from "@/stores/endpoint-store"

interface EndpointConfigProps {
  onCancel: () => void
  onSaved: () => void
}

type ValidateStatus = "idle" | "loading" | "success" | "error"

export function EndpointConfig({ onCancel, onSaved }: EndpointConfigProps) {
  const {
    protocol,
    ip,
    port,
    validated,
    setProtocol,
    setIp,
    setPort,
    validateEndpoint,
    saveEndpoint,
    loadEndpoint,
  } = useEndpointStore()

  const [status, setStatus] = React.useState<ValidateStatus>("idle")

  React.useEffect(() => {
    loadEndpoint()
  }, [loadEndpoint])

  const handleValidate = async (e: React.FormEvent) => {
    e.preventDefault()
    setStatus("loading")
    const ok = await validateEndpoint()
    if (ok) {
      setStatus("success")
    } else {
      setStatus("error")
      setTimeout(() => setStatus("idle"), 2000)
    }
  }

  const handleSave = async () => {
    await saveEndpoint()
    onSaved()
  }

  return (
    <div
      className="box-border px-6"
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
    >
      <div className="mx-auto mt-5 w-[95%]">
        <form onSubmit={handleValidate} className="space-y-5">
          <div className="flex flex-col gap-1.5">
            <Label className="mb-4 text-sm font-bold">协议</Label>
            <Select value={protocol} onValueChange={setProtocol}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="http://">http</SelectItem>
                <SelectItem value="https://">https</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="mb-4 text-sm font-bold">
              通讯地址
              <em className="ml-1 text-xs font-light">(ip或域名)</em>
            </Label>
            <Input
              placeholder="请输入IP地址"
              value={ip}
              onChange={(e) => setIp(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="mb-4 text-sm font-bold">端口</Label>
            <Input
              type="number"
              placeholder="请输入端口"
              value={port}
              onChange={(e) => setPort(Number(e.target.value))}
            />
          </div>

          <div className="flex w-full justify-end gap-2">
            {status === "success" || validated ? (
              <Button variant="outline" onClick={handleSave}>
                <IconShieldCheck className="mr-1 size-5" />
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
