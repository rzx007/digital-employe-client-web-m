import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { useActivationRequired, useActivationStatus } from "@/lib/activation/use-activation"
import { ActivationForm } from "./activation-form"

/**
 * About 页激活区：仅在强制激活时显示。展示授权状态 / 到期，并允许重新激活。
 */
export function ActivationAboutSection() {
  const required = useActivationRequired()
  const { data, refetch } = useActivationStatus(required)

  if (!required) return null

  const status = data?.data
  const activated = status?.activated
  const expiresAt = status?.expires_at
  const daysRemaining = status?.days_remaining

  return (
    <Card>
      <CardHeader>
        <CardTitle>授权激活</CardTitle>
        <CardDescription>
          本机设备授权状态。到期后需联系管理员重新签发授权码。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">授权状态</span>
            <span className="text-sm font-medium">
              {activated ? "已激活" : "未激活 / 已过期"}
            </span>
          </div>
          {expiresAt && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">到期时间</span>
              <span className="font-mono text-sm font-medium">
                {new Date(expiresAt).toLocaleString()}
              </span>
            </div>
          )}
          {typeof daysRemaining === "number" && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">剩余天数</span>
              <span className="text-sm font-medium">{daysRemaining} 天</span>
            </div>
          )}
        </div>

        <ActivationForm onActivated={() => void refetch()} />
      </CardContent>
    </Card>
  )
}
