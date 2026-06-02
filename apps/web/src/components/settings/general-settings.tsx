import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"
import {
  IconSun,
  IconMoon,
  IconDeviceDesktop,
  IconRocket,
} from "@tabler/icons-react"
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
import { getConfigKv, setConfigKv } from "@/api/config-kv"
import { fetchRuntimeConfig } from "@/api/system"
import { useTheme } from "@/components/theme-provider"
import { useOnboardingStore } from "@/stores/onboarding-store"
import { ThemeCard } from "./theme-card"
import { isElectron, withElectronApi } from "@/lib/electron/host"

const AGENT_MAX_CONCURRENT_CAP = 8
const AGENT_MAX_CONCURRENT_DEFAULT = 1

function clampAgentMaxConcurrent(value: number): number {
  if (!Number.isFinite(value) || value < 1) return 1
  if (value > AGENT_MAX_CONCURRENT_CAP) return AGENT_MAX_CONCURRENT_CAP
  return Math.floor(value)
}

export function GeneralSettings() {
  const queryClient = useQueryClient()
  const { theme, setTheme } = useTheme()
  const resetOnboarding = useOnboardingStore((s) => s.resetOnboarding)
  const [autoLaunch, setAutoLaunch] = React.useState(false)
  const [autoUpdate, setAutoUpdate] = React.useState(true)
  const [notifications, setNotifications] = React.useState(true)
  const [agentSerialMode, setAgentSerialMode] = React.useState(false)
  const [agentMaxConcurrent, setAgentMaxConcurrent] = React.useState(
    AGENT_MAX_CONCURRENT_DEFAULT
  )
  const [savingAgentSerialMode, setSavingAgentSerialMode] =
    React.useState(false)
  const [savingAgentMaxConcurrent, setSavingAgentMaxConcurrent] =
    React.useState(false)

  React.useEffect(() => {
    if (!isElectron()) return
    void withElectronApi(async (api) => {
      const [autoLaunchVal, autoUpdateVal, notificationsVal] =
        await Promise.all([
          api.getAutoLaunch(),
          api.getAutoUpdate(),
          api.getNotifications(),
        ])
      setAutoLaunch(autoLaunchVal)
      setAutoUpdate(autoUpdateVal)
      setNotifications(notificationsVal)
    })
  }, [])

  React.useEffect(() => {
    void Promise.all([
      getConfigKv("AGENT_SERIAL_MODE"),
      getConfigKv("AGENT_MAX_CONCURRENT_STREAMS"),
    ])
      .then(([serialKv, maxKv]) => {
        setAgentSerialMode(serialKv?.config_value === "1")
        const raw = Number.parseInt(maxKv?.config_value ?? "", 10)
        setAgentMaxConcurrent(
          clampAgentMaxConcurrent(
            Number.isFinite(raw) ? raw : AGENT_MAX_CONCURRENT_DEFAULT
          )
        )
      })
      .catch(() => { })
  }, [])

  const patchRuntimeAgentRuntime = React.useCallback(
    (
      serialMode: boolean,
      maxConcurrent: number
    ) => {
      queryClient.setQueryData(
        ["system", "runtime"],
        (prev: Awaited<ReturnType<typeof fetchRuntimeConfig>> | undefined) => {
          if (!prev?.data?.agent_runtime) return prev
          return {
            ...prev,
            data: {
              ...prev.data,
              agent_runtime: {
                ...prev.data.agent_runtime,
                serial_mode: serialMode,
                max_concurrent_streams: serialMode ? maxConcurrent : 0,
              },
            },
          }
        }
      )
    },
    [queryClient]
  )

  const handleAutoLaunchChange = async (checked: boolean) => {
    setAutoLaunch(checked)
    if (isElectron()) {
      await withElectronApi((api) => api.setAutoLaunch(checked))
    }
  }

  const handleAutoUpdateChange = async (checked: boolean) => {
    setAutoUpdate(checked)
    if (isElectron()) {
      await withElectronApi((api) => api.setAutoUpdate(checked))
    }
  }

  const handleNotificationsChange = async (checked: boolean) => {
    setNotifications(checked)
    if (isElectron()) {
      await withElectronApi((api) => api.setNotifications(checked))
    }
  }

  const handleAgentSerialModeChange = async (checked: boolean) => {
    setAgentSerialMode(checked)
    setSavingAgentSerialMode(true)
    const max = clampAgentMaxConcurrent(agentMaxConcurrent)
    try {
      await setConfigKv("AGENT_SERIAL_MODE", checked ? "1" : "0")
      queryClient.setQueryData(["config-kv", "AGENT_SERIAL_MODE"], {
        config_key: "AGENT_SERIAL_MODE",
        config_value: checked ? "1" : "0",
      })
      patchRuntimeAgentRuntime(checked, max)
      await queryClient.invalidateQueries({
        queryKey: ["system", "runtime"],
      })
      await queryClient.invalidateQueries({
        queryKey: ["config-kv", "AGENT_SERIAL_MODE"],
      })
      // toast.success("Agent 串行模式已更新")
    } catch {
      setAgentSerialMode(!checked)
      toast.error("保存 Agent 串行模式失败")
    } finally {
      setSavingAgentSerialMode(false)
    }
  }

  const persistAgentMaxConcurrent = async (raw: number) => {
    const next = clampAgentMaxConcurrent(raw)
    const prev = agentMaxConcurrent
    setAgentMaxConcurrent(next)
    setSavingAgentMaxConcurrent(true)
    try {
      await setConfigKv("AGENT_MAX_CONCURRENT_STREAMS", String(next))
      queryClient.setQueryData(
        ["config-kv", "AGENT_MAX_CONCURRENT_STREAMS"],
        {
          config_key: "AGENT_MAX_CONCURRENT_STREAMS",
          config_value: String(next),
        }
      )
      if (agentSerialMode) {
        patchRuntimeAgentRuntime(true, next)
      }
      await queryClient.invalidateQueries({
        queryKey: ["system", "runtime"],
      })
      await queryClient.invalidateQueries({
        queryKey: ["config-kv", "AGENT_MAX_CONCURRENT_STREAMS"],
      })
      toast.success("Agent 并发上限已更新")
    } catch {
      setAgentMaxConcurrent(prev)
      toast.error("保存 Agent 并发上限失败")
    } finally {
      setSavingAgentMaxConcurrent(false)
    }
  }

  const handleAgentMaxConcurrentBlur = () => {
    void persistAgentMaxConcurrent(agentMaxConcurrent)
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>外观设置</CardTitle>
          <CardDescription>选择应用的外观主题</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-3">
            <ThemeCard
              label="浅色"
              icon={IconSun}
              description="明亮的浅色背景"
              active={theme === "light"}
              onClick={() => setTheme("light")}
            />
            <ThemeCard
              label="深色"
              icon={IconMoon}
              description="暗色调护眼模式"
              active={theme === "dark"}
              onClick={() => setTheme("dark")}
            />
            <ThemeCard
              label="跟随系统"
              icon={IconDeviceDesktop}
              description="自动适配系统主题"
              active={theme === "system"}
              onClick={() => setTheme("system")}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>启动与更新</CardTitle>
          <CardDescription>配置应用启动和自动更新行为</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">开机自启动</span>
              <span className="text-xs text-muted-foreground">
                系统启动时自动打开应用
              </span>
            </div>
            <Switch
              checked={autoLaunch}
              onCheckedChange={handleAutoLaunchChange}
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">自动检查更新</span>
              <span className="text-xs text-muted-foreground">
                有新版本时自动提示
              </span>
            </div>
            <Switch
              checked={autoUpdate}
              onCheckedChange={handleAutoUpdateChange}
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">消息通知</span>
              <span className="text-xs text-muted-foreground">
                接收新消息时显示系统通知
              </span>
            </div>
            <Switch
              checked={notifications}
              onCheckedChange={handleNotificationsChange}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>性能与资源</CardTitle>
          <CardDescription>限制 Agent 同时执行数量</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">Agent 串行模式</span>
              <span className="text-xs text-muted-foreground">
                超出上限自动排队
              </span>
            </div>
            <Switch
              checked={agentSerialMode}
              disabled={savingAgentSerialMode}
              onCheckedChange={handleAgentSerialModeChange}
            />
          </div>
          {agentSerialMode && (
            <div className="flex items-center justify-between gap-4 border-t pt-4">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">最大并发数</span>
                <span className="text-xs text-muted-foreground">
                  {AGENT_MAX_CONCURRENT_DEFAULT}–{AGENT_MAX_CONCURRENT_CAP}
                </span>
              </div>
              <Input
                type="number"
                min={1}
                max={AGENT_MAX_CONCURRENT_CAP}
                className="w-20"
                value={agentMaxConcurrent}
                disabled={savingAgentMaxConcurrent}
                onChange={(e) => {
                  const parsed = Number.parseInt(e.target.value, 10)
                  if (Number.isFinite(parsed)) {
                    setAgentMaxConcurrent(parsed)
                  }
                }}
                onBlur={handleAgentMaxConcurrentBlur}
              />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>新手引导</CardTitle>
          <CardDescription>重新查看应用核心功能的使用引导</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">重新查看引导</span>
              <span className="text-xs text-muted-foreground">
                重新播放应用核心功能的使用引导 <em>(重启应用后生效)</em>
              </span>
            </div>
            <Button variant="outline" size="sm" onClick={resetOnboarding}>
              <IconRocket className="mr-2 size-4" />
              重新查看引导
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
