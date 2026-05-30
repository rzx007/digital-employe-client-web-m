import * as React from "react"
import { IconFolderOpen, IconDownload } from "@tabler/icons-react"
import pkg from "../../../package.json"
import logoSvg from "@/assets/logo.png"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Separator } from "@workspace/ui/components/separator"
import { UpdateButton } from "@/components/common/app-updater"
import { isElectron, withElectronApi } from "@/lib/electron/host"
import { ActivationAboutSection } from "@/components/activation/activation-about-section"
import { toast } from "sonner"

export function AboutSettings() {
  const [exporting, setExporting] = React.useState(false)
  const desktop = isElectron()

  const handleOpenLogsDir = async () => {
    await withElectronApi((api) => api.openLogsDirectory(), {
      onError: (error) => {
        toast.error(
          error instanceof Error ? error.message : "无法打开日志文件夹"
        )
      },
    })
  }

  const handleExportLogs = async () => {
    setExporting(true)
    const result = await withElectronApi((api) => api.exportLogs(), {
      silent: true,
      onError: (error) => {
        toast.error(error instanceof Error ? error.message : "导出失败")
      },
    })
    setExporting(false)
    if (result?.path) {
      toast.success("日志已导出")
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <ActivationAboutSection />
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
            <span className="text-xl font-semibold">Boban</span>
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

      <Card>
        <CardHeader>
          <CardTitle>诊断与支持</CardTitle>
          <CardDescription>
            导出 main.log、app.log、error.log，用于排查问题。日志可能包含
            API Key、路径等敏感信息，请勿随意外传。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {!desktop && (
            <p className="text-xs text-muted-foreground">
              仅桌面客户端支持日志导出。
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!desktop}
              onClick={() => void handleOpenLogsDir()}
            >
              <IconFolderOpen className="mr-2 size-4" />
              打开日志文件夹
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!desktop || exporting}
              onClick={() => void handleExportLogs()}
            >
              <IconDownload className="mr-2 size-4" />
              {exporting ? "导出中…" : "导出日志…"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
