import pkg from "../../../package.json"
import logoSvg from "@/assets/logo.png"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Separator } from "@workspace/ui/components/separator"
import { UpdateButton } from "@/components/common/app-updater"

export function AboutSettings() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>关于</CardTitle>
        <CardDescription>应用信息</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="flex flex-col items-center gap-3 py-4">
          <div className="flex size-16 items-center justify-center rounded-2xl text-2xl font-bold text-primary-foreground">
            <img src={logoSvg} className="w-10" alt="" />
          </div>
          <span className="text-xl font-semibold">DigitalEmployee</span>
          <span className="text-xs text-muted-foreground">
            数字员工智能助手
          </span>
        </div>

        <Separator />

        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">应用版本</span>
            <span className="font-mono text-sm font-medium">
              v{pkg.version}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">构建时间</span>
            <span className="font-mono text-sm font-medium">
              {typeof __BUILD_TIME__ !== "undefined" ? __BUILD_TIME__ : "-"}
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">版本更新</span>
          </div>
          <UpdateButton />
        </div>

        <p className="text-center text-xs text-muted-foreground">
          © {new Date().getFullYear()} Bobandata. All rights reserved.
        </p>
      </CardContent>
    </Card>
  )
}
