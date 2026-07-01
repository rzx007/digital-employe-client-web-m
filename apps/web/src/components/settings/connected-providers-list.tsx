import * as React from "react"
import {
  IconAlertCircle,
  IconDots,
  IconPencil,
  IconPlugConnected,
  IconTrash,
} from "@tabler/icons-react"
import { toast } from "sonner"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@workspace/ui/components/accordion"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { RadioGroup, RadioGroupItem } from "@workspace/ui/components/radio-group"
import { cn } from "@workspace/ui/lib/utils"
import {
  activeModelKey,
  deleteLlmProvider,
  parseActiveModelKey,
  setActiveLlmModel,
  testLlmProvider,
  type LlmRegistry,
  type LlmRegistryProvider,
} from "@/api/model"
import { EditProviderDialog } from "./edit-provider-dialog"

function providerInitial(name: string): string {
  const trimmed = name.trim()
  return trimmed ? trimmed.charAt(0).toUpperCase() : "?"
}

export function ConnectedProvidersList({
  registry,
  onRegistryChange,
  activating,
  onActivatingChange,
}: {
  registry: LlmRegistry
  onRegistryChange: (next: LlmRegistry) => void
  activating: boolean
  onActivatingChange: (v: boolean) => void
}) {
  const [testingId, setTestingId] = React.useState<string | null>(null)
  const [editProvider, setEditProvider] =
    React.useState<LlmRegistryProvider | null>(null)

  const activeValue =
    registry.active_provider_id && registry.active_model_id
      ? activeModelKey(registry.active_provider_id, registry.active_model_id)
      : ""

  const handleActiveChange = async (value: string) => {
    const parsed = parseActiveModelKey(value)
    if (!parsed) return
    onActivatingChange(true)
    try {
      const next = await setActiveLlmModel(parsed.providerId, parsed.modelId)
      onRegistryChange(next)
      toast.success("已切换当前使用模型，新开对话将立即生效")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "切换失败")
    } finally {
      onActivatingChange(false)
    }
  }

  const handleTest = async (provider: LlmRegistryProvider) => {
    setTestingId(provider.id)
    try {
      const result = await testLlmProvider(provider.id)
      if (result.ok) {
        toast.success(result.message || "连接成功")
      } else {
        toast.error(result.message || "连接失败")
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "连接测试失败")
    } finally {
      setTestingId(null)
    }
  }

  const handleDelete = async (provider: LlmRegistryProvider) => {
    const confirmed = window.confirm(
      `确定删除「${provider.display_name}」？已保存的 API Key 将一并移除。`
    )
    if (!confirmed) return
    try {
      const next = await deleteLlmProvider(provider.id)
      onRegistryChange(next)
      toast.success("已删除供应商")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除失败")
    }
  }

  if (registry.providers.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-12 text-center">
        <div className="flex size-10 items-center justify-center rounded-full bg-muted">
          <IconPlugConnected className="size-5 text-muted-foreground" />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium">尚未接入供应商</p>
          <p className="text-xs text-muted-foreground">
            点击右上角「添加供应商」，接入后可在此单选当前使用的模型
          </p>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-3 px-0.5">
          <p className="text-sm font-medium">已接入供应商</p>
          <p className="text-xs text-muted-foreground">单选模型，全局仅一项生效</p>
        </div>

        <RadioGroup
          value={activeValue}
          onValueChange={handleActiveChange}
          className="gap-0"
          disabled={activating}
        >
          <Accordion
            type="multiple"
            defaultValue={registry.providers.map((p) => p.id)}
            className="rounded-md border bg-card"
          >
            {registry.providers.map((provider) => {
              const hasActiveModel = provider.models.some(
                (m) => activeValue === activeModelKey(provider.id, m.id)
              )
              const needsKey =
                !provider.api_key_present && provider.source !== "custom"

              return (
                <AccordionItem
                  key={provider.id}
                  value={provider.id}
                  className="border-0 border-b border-border/60 last:border-b-0"
                >
                  <AccordionTrigger className="min-h-14 flex-1 px-4 py-3 hover:bg-muted/40 hover:no-underline [&>svg]:size-4">
                    <div className="flex min-w-0 flex-1 items-center gap-3 text-left">
                      <div
                        className={cn(
                          "flex size-9 shrink-0 items-center justify-center rounded-lg text-sm font-semibold",
                          hasActiveModel
                            ? "bg-primary/10 text-primary"
                            : "bg-muted text-muted-foreground"
                        )}
                        aria-hidden
                      >
                        {providerInitial(provider.display_name)}
                      </div>
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-sm font-medium">
                            {provider.display_name}
                          </span>
                          <Badge
                            variant="outline"
                            className="h-5 px-1.5 font-normal text-[10px] text-muted-foreground"
                          >
                            {provider.models.length} 个模型
                          </Badge>
                          {needsKey && (
                            <Badge
                              variant="outline"
                              className="h-5 gap-0.5 border-amber-500/30 bg-amber-500/10 px-1.5 text-[10px] text-amber-700 dark:text-amber-400"
                            >
                              <IconAlertCircle className="size-3" />
                              缺 Key
                            </Badge>
                          )}
                        </div>
                        <p
                          className="truncate font-mono text-[11px] text-muted-foreground"
                          title={provider.base_url}
                        >
                          {provider.base_url}
                        </p>
                      </div>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="my-auto size-8 shrink-0 text-muted-foreground"
                          aria-label={`${provider.display_name} 操作`}
                        >
                          <IconDots className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-40">
                        <DropdownMenuItem
                          onClick={() => void handleTest(provider)}
                          disabled={testingId === provider.id}
                        >
                          <IconPlugConnected className="size-4" />
                          {testingId === provider.id ? "测试中…" : "测试连接"}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => setEditProvider(provider)}
                        >
                          <IconPencil className="size-4" />
                          编辑
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => void handleDelete(provider)}
                        >
                          <IconTrash className="size-4" />
                          删除
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </AccordionTrigger>

                  <AccordionContent className="px-0 pb-0">
                    <div className="border-t border-border/50 bg-muted/20 px-2 py-2">
                      {provider.models.map((model) => {
                        const rowKey = activeModelKey(provider.id, model.id)
                        const isActive = activeValue === rowKey
                        return (
                          <label
                            key={model.id}
                            htmlFor={rowKey}
                            className={cn(
                              "flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 transition-colors duration-150",
                              isActive
                                ? "bg-background shadow-sm ring-1 ring-primary/25"
                                : "hover:bg-background/60"
                            )}
                          >
                            <RadioGroupItem
                              id={rowKey}
                              value={rowKey}
                              className="shrink-0"
                            />
                            <div className="min-w-0 flex-1">
                              <p className="truncate font-mono text-sm leading-tight">
                                {model.id}
                              </p>
                              {model.display_name &&
                                model.display_name !== model.id && (
                                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                                    {model.display_name}
                                  </p>
                                )}
                            </div>
                            {isActive && (
                              <Badge className="shrink-0 font-normal">
                                当前使用
                              </Badge>
                            )}
                          </label>
                        )
                      })}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              )
            })}
          </Accordion>
        </RadioGroup>
      </div>

      {editProvider && (
        <EditProviderDialog
          provider={editProvider}
          open={Boolean(editProvider)}
          onOpenChange={(open: boolean) => {
            if (!open) setEditProvider(null)
          }}
          onSaved={onRegistryChange}
        />
      )}
    </>
  )
}
