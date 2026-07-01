import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"
import {
  IconSun,
  IconMoon,
  IconDeviceDesktop,
} from "@tabler/icons-react"
import { toast } from "sonner"
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
import { ThemeCard } from "./theme-card"
import { applySkin, clearSkin, getStoredSkin, SKINS } from "@/lib/theme/skins"
import { SkinPreviewCard } from "./skin-preview-card"
import { isElectron, subscribeElectron, withElectronApi } from "@/lib/electron/host"

const AGENT_MAX_CONCURRENT_CAP = 8
const AGENT_MAX_CONCURRENT_DEFAULT = 1

function clampAgentMaxConcurrent(value: number): number {
  if (!Number.isFinite(value) || value < 1) return 1
  if (value > AGENT_MAX_CONCURRENT_CAP) return AGENT_MAX_CONCURRENT_CAP
  return Math.floor(value)
}

// 执行命令/跑脚本时长时间不吐正文的判死阈值（秒）。过短会误杀正常长命令。
const AGENT_NO_CONTENT_KILL_MIN = 60
const AGENT_NO_CONTENT_KILL_MAX = 3600
const AGENT_NO_CONTENT_KILL_DEFAULT = 900

function clampAgentNoContentKill(value: number): number {
  if (!Number.isFinite(value)) return AGENT_NO_CONTENT_KILL_DEFAULT
  if (value < AGENT_NO_CONTENT_KILL_MIN) return AGENT_NO_CONTENT_KILL_MIN
  if (value > AGENT_NO_CONTENT_KILL_MAX) return AGENT_NO_CONTENT_KILL_MAX
  return Math.floor(value)
}

// 并行子任务（单员工内 deepagents task 子任务）最大并发数。
const SUBAGENT_MAX_PARALLEL_CAP = 8
const SUBAGENT_MAX_PARALLEL_DEFAULT = 3

function clampSubagentMaxParallel(value: number): number {
  if (!Number.isFinite(value) || value < 1) return 1
  if (value > SUBAGENT_MAX_PARALLEL_CAP) return SUBAGENT_MAX_PARALLEL_CAP
  return Math.floor(value)
}

export function GeneralSettings() {
  const queryClient = useQueryClient()
  const { theme, setTheme } = useTheme()
  const [skin, setSkinState] = React.useState(getStoredSkin)

  const handleSkin = (id: string) => {
    applySkin(id)
    setSkinState(id)
  }

  const handleBaseMode = (mode: "light" | "dark" | "system") => {
    clearSkin()
    setSkinState("")
    setTheme(mode)
  }

  React.useEffect(() => {
    return subscribeElectron((api) =>
      api.onThemeChanged(() => {
        setSkinState(getStoredSkin())
      })
    )
  }, [])

  const [autoLaunch, setAutoLaunch] = React.useState(false)
  const [autoUpdate, setAutoUpdate] = React.useState(true)
  const [notifications, setNotifications] = React.useState(true)
  const [agentSerialMode, setAgentSerialMode] = React.useState(false)
  const [agentMaxConcurrent, setAgentMaxConcurrent] = React.useState(
    AGENT_MAX_CONCURRENT_DEFAULT
  )
  const [agentNoContentKill, setAgentNoContentKill] = React.useState(
    AGENT_NO_CONTENT_KILL_DEFAULT
  )
  const [savingAgentSerialMode, setSavingAgentSerialMode] =
    React.useState(false)
  const [savingAgentMaxConcurrent, setSavingAgentMaxConcurrent] =
    React.useState(false)
  const [savingAgentNoContentKill, setSavingAgentNoContentKill] =
    React.useState(false)
  const [subagentEnabled, setSubagentEnabled] = React.useState(true)
  const [subagentMaxParallel, setSubagentMaxParallel] = React.useState(
    SUBAGENT_MAX_PARALLEL_DEFAULT
  )
  const [savingSubagentEnabled, setSavingSubagentEnabled] =
    React.useState(false)
  const [savingSubagentMaxParallel, setSavingSubagentMaxParallel] =
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
      getConfigKv("AGENT_NO_CONTENT_KILL_SECONDS"),
    ])
      .then(([serialKv, maxKv, noContentKv]) => {
        setAgentSerialMode(serialKv?.config_value === "1")
        const raw = Number.parseInt(maxKv?.config_value ?? "", 10)
        setAgentMaxConcurrent(
          clampAgentMaxConcurrent(
            Number.isFinite(raw) ? raw : AGENT_MAX_CONCURRENT_DEFAULT
          )
        )
        const killRaw = Number.parseInt(noContentKv?.config_value ?? "", 10)
        setAgentNoContentKill(
          clampAgentNoContentKill(
            Number.isFinite(killRaw) ? killRaw : AGENT_NO_CONTENT_KILL_DEFAULT
          )
        )
      })
      .catch(() => { })
  }, [])

  React.useEffect(() => {
    void Promise.all([
      getConfigKv("SUBAGENT_ENABLED"),
      getConfigKv("SUBAGENT_MAX_PARALLEL"),
    ])
      .then(([enabledKv, maxKv]) => {
        // 默认开：仅当显式存了 "0" 才算关。
        setSubagentEnabled(enabledKv?.config_value !== "0")
        const raw = Number.parseInt(maxKv?.config_value ?? "", 10)
        setSubagentMaxParallel(
          clampSubagentMaxParallel(
            Number.isFinite(raw) ? raw : SUBAGENT_MAX_PARALLEL_DEFAULT
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

  const persistAgentNoContentKill = async (raw: number) => {
    const next = clampAgentNoContentKill(raw)
    const prev = agentNoContentKill
    setAgentNoContentKill(next)
    setSavingAgentNoContentKill(true)
    try {
      await setConfigKv("AGENT_NO_CONTENT_KILL_SECONDS", String(next))
      queryClient.setQueryData(
        ["config-kv", "AGENT_NO_CONTENT_KILL_SECONDS"],
        {
          config_key: "AGENT_NO_CONTENT_KILL_SECONDS",
          config_value: String(next),
        }
      )
      toast.success("命令无输出判死阈值已更新（重启后端后生效）")
    } catch {
      setAgentNoContentKill(prev)
      toast.error("保存命令无输出判死阈值失败")
    } finally {
      setSavingAgentNoContentKill(false)
    }
  }

  const handleAgentNoContentKillBlur = () => {
    void persistAgentNoContentKill(agentNoContentKill)
  }

  const handleSubagentEnabledChange = async (checked: boolean) => {
    const prev = subagentEnabled
    setSubagentEnabled(checked)
    setSavingSubagentEnabled(true)
    try {
      await setConfigKv("SUBAGENT_ENABLED", checked ? "1" : "0")
      queryClient.setQueryData(["config-kv", "SUBAGENT_ENABLED"], {
        config_key: "SUBAGENT_ENABLED",
        config_value: checked ? "1" : "0",
      })
      toast.success(
        checked ? "已开启并行子任务（新会话生效）" : "已关闭并行子任务（新会话生效）"
      )
    } catch {
      setSubagentEnabled(prev)
      toast.error("保存并行子任务开关失败")
    } finally {
      setSavingSubagentEnabled(false)
    }
  }

  const persistSubagentMaxParallel = async (raw: number) => {
    const next = clampSubagentMaxParallel(raw)
    const prev = subagentMaxParallel
    setSubagentMaxParallel(next)
    setSavingSubagentMaxParallel(true)
    try {
      await setConfigKv("SUBAGENT_MAX_PARALLEL", String(next))
      queryClient.setQueryData(["config-kv", "SUBAGENT_MAX_PARALLEL"], {
        config_key: "SUBAGENT_MAX_PARALLEL",
        config_value: String(next),
      })
      toast.success("子任务最大并发数已更新（新会话生效）")
    } catch {
      setSubagentMaxParallel(prev)
      toast.error("保存子任务最大并发数失败")
    } finally {
      setSavingSubagentMaxParallel(false)
    }
  }

  const handleSubagentMaxParallelBlur = () => {
    void persistSubagentMaxParallel(subagentMaxParallel)
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
              active={!skin && theme === "light"}
              onClick={() => handleBaseMode("light")}
            />
            <ThemeCard
              label="深色"
              icon={IconMoon}
              description="暗色调护眼模式"
              active={!skin && theme === "dark"}
              onClick={() => handleBaseMode("dark")}
            />
            <ThemeCard
              label="跟随系统"
              icon={IconDeviceDesktop}
              description="自动适配系统主题"
              active={!skin && theme === "system"}
              onClick={() => handleBaseMode("system")}
            />
          </div>

          <div className="mt-4 border-t pt-4">
            <p className="mb-3 text-sm font-medium">特殊风格</p>
            <div className="grid grid-cols-4 gap-3">
              {SKINS.map((s) => (
                <SkinPreviewCard
                  key={s.id}
                  skin={s}
                  active={skin === s.id}
                  onSelect={() => handleSkin(s.id)}
                />
              ))}
            </div>
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

          <div className="flex items-center justify-between gap-4 border-t pt-4">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">命令无输出判死阈值（秒）</span>
              <span className="text-xs text-muted-foreground">
                执行命令/跑脚本长时间不输出正文才判定卡死回收，过短会误杀正常长命令。
                {AGENT_NO_CONTENT_KILL_MIN}–{AGENT_NO_CONTENT_KILL_MAX}，默认{" "}
                {AGENT_NO_CONTENT_KILL_DEFAULT}（重启后端后生效）
              </span>
            </div>
            <Input
              type="number"
              min={AGENT_NO_CONTENT_KILL_MIN}
              max={AGENT_NO_CONTENT_KILL_MAX}
              step={30}
              className="w-24"
              value={agentNoContentKill}
              disabled={savingAgentNoContentKill}
              onChange={(e) => {
                const parsed = Number.parseInt(e.target.value, 10)
                if (Number.isFinite(parsed)) {
                  setAgentNoContentKill(parsed)
                }
              }}
              onBlur={handleAgentNoContentKillBlur}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>并行子任务</CardTitle>
          <CardDescription>
            员工把活拆成多个独立子任务并行执行（单员工内部）
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">启用并行子任务</span>
              <span className="text-xs text-muted-foreground">
                关闭后员工不再拆分并行子任务（新会话/新任务生效）
              </span>
            </div>
            <Switch
              checked={subagentEnabled}
              disabled={savingSubagentEnabled}
              onCheckedChange={handleSubagentEnabledChange}
            />
          </div>
          {subagentEnabled && (
            <div className="flex items-center justify-between gap-4 border-t pt-4">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">最大并发数</span>
                <span className="text-xs text-muted-foreground">
                  同时运行的子任务上限，1–{SUBAGENT_MAX_PARALLEL_CAP}，默认{" "}
                  {SUBAGENT_MAX_PARALLEL_DEFAULT}（过高会占满单卡 GPU）
                </span>
              </div>
              <Input
                type="number"
                min={1}
                max={SUBAGENT_MAX_PARALLEL_CAP}
                className="w-20"
                value={subagentMaxParallel}
                disabled={savingSubagentMaxParallel}
                onChange={(e) => {
                  const parsed = Number.parseInt(e.target.value, 10)
                  if (Number.isFinite(parsed)) {
                    setSubagentMaxParallel(parsed)
                  }
                }}
                onBlur={handleSubagentMaxParallelBlur}
              />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
