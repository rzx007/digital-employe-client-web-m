import * as React from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  IconChevronDown,
  IconCircleCheck,
  IconCloudDownload,
  IconLoader2,
  IconPlus,
  IconSparkles,
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Separator } from "@workspace/ui/components/separator"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { cn } from "@workspace/ui/lib/utils"
import {
  fetchAvailableCatalogIds,
  fetchLlmRegistry,
  syncModelFromRemote,
  type LlmRegistry,
} from "@/api/model"
import { getConfigKv, setManyConfigKv } from "@/api/config-kv"
import { modelKeys } from "@/lib/query-keys/model"
import { useCapability } from "@/lib/runtime/runtime-provider"
import { AddProviderDialog } from "./add-provider-dialog"
import { ConnectedProvidersList } from "./connected-providers-list"

function resolveActiveParts(registry: LlmRegistry): {
  providerName: string
  modelId: string
} | null {
  if (!registry.active_provider_id || !registry.active_model_id) {
    return null
  }
  const provider = registry.providers.find(
    (p) => p.id === registry.active_provider_id
  )
  return {
    providerName: provider?.display_name ?? registry.active_provider_id,
    modelId: registry.active_model_id,
  }
}

export function ModelsSettings() {
  const queryClient = useQueryClient()
  const canSyncRemoteModel = useCapability("remote_model_sync")
  const [addOpen, setAddOpen] = React.useState(false)
  const [activating, setActivating] = React.useState(false)
  const [syncingRemote, setSyncingRemote] = React.useState(false)
  const [advancedOpen, setAdvancedOpen] = React.useState(false)
  const [maxInputTokens, setMaxInputTokens] = React.useState("")
  const [savingTokens, setSavingTokens] = React.useState(false)

  const registryQuery = useQuery({
    queryKey: modelKeys.registry(),
    queryFn: fetchLlmRegistry,
  })

  const availableQuery = useQuery({
    queryKey: modelKeys.availableCatalog(),
    queryFn: fetchAvailableCatalogIds,
  })

  React.useEffect(() => {
    void getConfigKv("MODEL_MAX_INPUT_TOKENS")
      .then((kv) => setMaxInputTokens(kv?.config_value?.trim() ?? ""))
      .catch(() => { })
  }, [])

  const handleRegistryChange = (next: LlmRegistry) => {
    queryClient.setQueryData(modelKeys.registry(), next)
    void queryClient.invalidateQueries({ queryKey: modelKeys.runtimeConfig() })
    void queryClient.invalidateQueries({ queryKey: modelKeys.availableCatalog() })
  }

  const handleSyncRemoteModel = async () => {
    setSyncingRemote(true)
    try {
      const result = await syncModelFromRemote()
      handleRegistryChange(result.registry)
      toast.success("已从平台同步模型配置")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "同步失败")
    } finally {
      setSyncingRemote(false)
    }
  }

  const handleSaveMaxTokens = async () => {
    const trimmed = maxInputTokens.trim()
    if (trimmed !== "") {
      const n = Number(trimmed)
      if (!Number.isInteger(n) || n <= 0) {
        toast.error("最大输入 Token 须为正整数")
        return
      }
    }
    setSavingTokens(true)
    try {
      await setManyConfigKv([
        { key: "MODEL_MAX_INPUT_TOKENS", value: trimmed },
      ])
      toast.success("高级选项已保存")
    } catch {
      toast.error("保存失败")
    } finally {
      setSavingTokens(false)
    }
  }

  const registry = registryQuery.data
  const active = registry ? resolveActiveParts(registry) : null

  return (
    <Card className="max-w-2xl border-0 shadow-none lg:border lg:shadow-sm">
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0 pb-4">
        <div className="space-y-1.5">
          <CardTitle className="text-lg">模型设置</CardTitle>
          <CardDescription className="text-pretty leading-relaxed">
            多家供应商凭证可并存；在下方列表中单选一个模型作为 Agent 当前使用
          </CardDescription>
        </div>
        <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
          {canSyncRemoteModel && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={syncingRemote}
              onClick={() => void handleSyncRemoteModel()}
            >
              {syncingRemote ? (
                <IconLoader2 className="size-4 animate-spin" />
              ) : (
                <IconCloudDownload className="size-4" />
              )}
              同步平台模型
            </Button>
          )}
          <Button type="button" size="sm" onClick={() => setAddOpen(true)}>
            <IconPlus className="size-4" />
            添加供应商
          </Button>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-6 pt-0">
        <section
          className={cn(
            "rounded-md border px-4 py-3.5 transition-colors",
            active
              ? "border-primary/20 bg-primary/[0.04]"
              : "border-border bg-muted/30"
          )}
          aria-live="polite"
        >
          <div className="flex items-start gap-3">
            <div
              className={cn(
                "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg",
                active ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
              )}
            >
              {registryQuery.isLoading ? (
                <IconLoader2 className="size-4 animate-spin" />
              ) : active ? (
                <IconCircleCheck className="size-4" />
              ) : (
                <IconSparkles className="size-4" />
              )}
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                当前使用
              </p>
              {registryQuery.isLoading ? (
                <div className="space-y-2 pt-0.5">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-48" />
                </div>
              ) : active ? (
                <>
                  <p className="truncate text-sm font-medium">{active.providerName}</p>
                  <p className="truncate font-mono text-xs text-muted-foreground">
                    {active.modelId}
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  未选择模型，请在下方列表中点选
                </p>
              )}
            </div>
          </div>
        </section>

        {registryQuery.isError && (
          <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            加载失败，请刷新页面重试
          </p>
        )}

        {registry && (
          <ConnectedProvidersList
            registry={registry}
            onRegistryChange={handleRegistryChange}
            activating={activating}
            onActivatingChange={setActivating}
          />
        )}

        {activating && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <IconLoader2 className="size-3.5 animate-spin" />
            正在切换模型…
          </p>
        )}

        <Separator />

        <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <IconChevronDown
                className={cn(
                  "size-4 shrink-0 transition-transform duration-200 ease-out",
                  advancedOpen && "rotate-180"
                )}
              />
              高级选项
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="flex flex-col gap-3 pt-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="model-max-input-tokens" className="text-sm">
                最大输入 Token（MODEL_MAX_INPUT_TOKENS）
              </Label>
              <Input
                id="model-max-input-tokens"
                type="number"
                min={1}
                step={1}
                placeholder="131072"
                className="max-w-xs font-mono text-sm"
                value={maxInputTokens}
                onChange={(e) => setMaxInputTokens(e.target.value)}
              />
              <p className="max-w-prose text-xs leading-relaxed text-muted-foreground">
                控制 Agent 上下文压缩预算。留空保存时使用服务端默认 131072。
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-fit"
                disabled={savingTokens}
                onClick={() => void handleSaveMaxTokens()}
              >
                {savingTokens ? "保存中…" : "保存高级选项"}
              </Button>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>

      <AddProviderDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        availableCatalogIds={availableQuery.data ?? []}
        onAdded={handleRegistryChange}
      />
    </Card>
  )
}
