import * as React from "react"
import { IconChevronRight, IconPlus } from "@tabler/icons-react"
import { toast } from "sonner"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Separator } from "@workspace/ui/components/separator"
import { cn } from "@workspace/ui/lib/utils"
import {
  addLlmProvider,
  fetchLlmProviders,
  testLlmConnection,
  type LlmProviderCatalogItem,
  type LlmRegistry,
  type RegistryModelInput,
} from "@/api/model"

type Step = "pick" | "preset" | "custom"

function PasswordInput({
  className,
  ...props
}: React.ComponentProps<"input">) {
  return (
    <input
      type="password"
      className={cn(
        "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 font-mono text-sm shadow-xs transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export function AddProviderDialog({
  open,
  onOpenChange,
  availableCatalogIds,
  onAdded,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  availableCatalogIds: string[]
  onAdded: (registry: LlmRegistry) => void
}) {
  const [step, setStep] = React.useState<Step>("pick")
  const [catalog, setCatalog] = React.useState<LlmProviderCatalogItem[]>([])
  const [selectedCatalogId, setSelectedCatalogId] = React.useState("")
  const [apiKey, setApiKey] = React.useState("")
  const [models, setModels] = React.useState<RegistryModelInput[]>([])
  const [customId, setCustomId] = React.useState("")
  const [customName, setCustomName] = React.useState("")
  const [customUrl, setCustomUrl] = React.useState("")
  const [customApiKey, setCustomApiKey] = React.useState("")
  const [submitting, setSubmitting] = React.useState(false)
  const [testing, setTesting] = React.useState(false)

  React.useEffect(() => {
    if (!open) {
      setStep("pick")
      setSelectedCatalogId("")
      setApiKey("")
      setModels([])
      setCustomId("")
      setCustomName("")
      setCustomUrl("")
      setCustomApiKey("")
      return
    }
    void fetchLlmProviders().then(setCatalog).catch(() => {
      toast.error("加载供应商目录失败")
    })
  }, [open])

  const availablePresets = catalog.filter((p) =>
    availableCatalogIds.includes(p.id)
  )

  const selectedPreset = catalog.find((p) => p.id === selectedCatalogId)

  const startPreset = (catalogId: string) => {
    const profile = catalog.find((p) => p.id === catalogId)
    if (!profile) return
    setSelectedCatalogId(catalogId)
    setModels(profile.default_models.map((id) => ({ id })))
    setApiKey("")
    setStep("preset")
  }

  const handleTestPreset = async () => {
    const modelId = models[0]?.id?.trim()
    if (!selectedCatalogId || !apiKey.trim()) {
      toast.error("请填写 API Key 和至少一个模型")
      return
    }
    if (!modelId) {
      toast.error("至少需要一个模型")
      return
    }
    setTesting(true)
    try {
      const result = await testLlmConnection({
        provider_id: selectedCatalogId,
        api_key: apiKey.trim(),
        model: modelId,
      })
      if (result.ok) toast.success(result.message || "连接成功")
      else toast.error(result.message || "连接失败")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "连接测试失败")
    } finally {
      setTesting(false)
    }
  }

  const handleSubmitPreset = async () => {
    if (!selectedCatalogId || !apiKey.trim()) {
      toast.error("请填写 API Key")
      return
    }
    const normalized = models.map((m) => ({ id: m.id.trim() })).filter((m) => m.id)
    if (normalized.length === 0) {
      toast.error("至少需要一个模型")
      return
    }
    setSubmitting(true)
    try {
      const next = await addLlmProvider({
        source: "preset",
        catalog_id: selectedCatalogId,
        api_key: apiKey.trim(),
        models: normalized,
        set_as_active: true,
      })
      onAdded(next)
      toast.success("已添加供应商")
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "添加失败")
    } finally {
      setSubmitting(false)
    }
  }

  const handleTestCustom = async () => {
    const modelId = models[0]?.id?.trim()
    if (!customUrl.trim() || !modelId) {
      toast.error("请填写 API 地址和模型")
      return
    }
    setTesting(true)
    try {
      const result = await testLlmConnection({
        provider_id: "custom",
        base_url: customUrl.trim(),
        api_key: customApiKey.trim() || undefined,
        model: modelId,
      })
      if (result.ok) toast.success(result.message || "连接成功")
      else toast.error(result.message || "连接失败")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "连接测试失败")
    } finally {
      setTesting(false)
    }
  }

  const handleSubmitCustom = async () => {
    if (!customId.trim() || !customName.trim() || !customUrl.trim()) {
      toast.error("请填写供应商 ID、名称与 API 地址")
      return
    }
    const normalized = models
      .map((m) => ({
        id: m.id.trim(),
        display_name: m.display_name?.trim() || null,
      }))
      .filter((m) => m.id)
    if (normalized.length === 0) {
      toast.error("至少需要一个模型")
      return
    }
    setSubmitting(true)
    try {
      const next = await addLlmProvider({
        source: "custom",
        provider_id: customId.trim().toLowerCase(),
        display_name: customName.trim(),
        base_url: customUrl.trim(),
        api_key: customApiKey.trim(),
        models: normalized,
        set_as_active: true,
      })
      onAdded(next)
      toast.success("已添加自定义供应商")
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "添加失败")
    } finally {
      setSubmitting(false)
    }
  }

  const updateModelRow = (
    index: number,
    field: "id" | "display_name",
    value: string
  ) => {
    setModels((prev) =>
      prev.map((row, i) => (i === index ? { ...row, [field]: value } : row))
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-md">
        <DialogHeader className="space-y-1.5 border-b px-6 py-4">
          <DialogTitle>
            {step === "pick" && "添加供应商"}
            {step === "preset" && selectedPreset?.display_name}
            {step === "custom" && "自定义供应商"}
          </DialogTitle>
          {step === "pick" && (
            <DialogDescription>
              选择预设或自定义 OpenAI 兼容接口
            </DialogDescription>
          )}
          {step !== "pick" && (
            <DialogDescription>
              填写凭证后测试连接，添加后将设为当前使用
            </DialogDescription>
          )}
        </DialogHeader>

        <div className="max-h-[min(60vh,28rem)] overflow-y-auto px-6 py-4">
          {step === "pick" && (
            <div className="flex flex-col gap-1">
              {availablePresets.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  预设供应商均已接入
                </p>
              ) : (
                availablePresets.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left transition-colors hover:bg-muted/60"
                    onClick={() => startPreset(p.id)}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{p.display_name}</p>
                      <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                        {p.base_url}
                      </p>
                    </div>
                    <IconChevronRight className="size-4 shrink-0 text-muted-foreground" />
                  </button>
                ))
              )}
              {availablePresets.length > 0 && (
                <Separator className="my-2" />
              )}
              <button
                type="button"
                className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left transition-colors hover:bg-muted/60"
                onClick={() => {
                  setModels([{ id: "", display_name: "" }])
                  setStep("custom")
                }}
              >
                <div className="flex size-8 items-center justify-center rounded-md border border-dashed bg-muted/50">
                  <IconPlus className="size-4 text-muted-foreground" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium">自定义供应商</p>
                  <p className="text-xs text-muted-foreground">
                    自行填写 API 地址与模型列表
                  </p>
                </div>
                <IconChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </button>
            </div>
          )}

          {step === "preset" && selectedPreset && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label>API Key</Label>
                <PasswordInput
                  placeholder="sk-..."
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label>模型 ID</Label>
                <div className="flex flex-col gap-2">
                  {models.map((model, index) => (
                    <Input
                      key={index}
                      className="font-mono text-sm"
                      value={model.id}
                      onChange={(e) => updateModelRow(index, "id", e.target.value)}
                    />
                  ))}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-fit px-2"
                  onClick={() => setModels((prev) => [...prev, { id: "" }])}
                >
                  <IconPlus className="size-3.5" />
                  添加模型
                </Button>
              </div>
            </div>
          )}

          {step === "custom" && (
            <div className="flex flex-col gap-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Label>供应商 ID</Label>
                  <Input
                    className="font-mono text-sm"
                    placeholder="my-provider"
                    value={customId}
                    onChange={(e) => setCustomId(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label>显示名称</Label>
                  <Input
                    value={customName}
                    onChange={(e) => setCustomName(e.target.value)}
                  />
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <Label>API 地址</Label>
                <Input
                  className="font-mono text-sm"
                  placeholder="https://api.example.com/v1"
                  value={customUrl}
                  onChange={(e) => setCustomUrl(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label>API Key（可选）</Label>
                <PasswordInput
                  value={customApiKey}
                  onChange={(e) => setCustomApiKey(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <Label>模型列表</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2"
                    onClick={() =>
                      setModels((prev) => [...prev, { id: "", display_name: "" }])
                    }
                  >
                    <IconPlus className="size-3.5" />
                    添加
                  </Button>
                </div>
                <div className="space-y-2 rounded-lg border bg-muted/20 p-2">
                  {models.map((model, index) => (
                    <div key={index} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                      <Input
                        className="font-mono text-sm"
                        placeholder="model-id"
                        value={model.id}
                        onChange={(e) =>
                          updateModelRow(index, "id", e.target.value)
                        }
                      />
                      <Input
                        placeholder="显示名称"
                        value={model.display_name ?? ""}
                        onChange={(e) =>
                          updateModelRow(index, "display_name", e.target.value)
                        }
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground"
                        disabled={models.length <= 1}
                        onClick={() =>
                          setModels((prev) => prev.filter((_, i) => i !== index))
                        }
                      >
                        移除
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {step !== "pick" && (
          <DialogFooter className="gap-2 border-t bg-muted/20 px-6 py-4 sm:justify-between">
            <Button type="button" variant="ghost" onClick={() => setStep("pick")}>
              返回
            </Button>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={testing || submitting}
                onClick={() =>
                  void (step === "preset" ? handleTestPreset() : handleTestCustom())
                }
              >
                {testing ? "测试中…" : "测试连接"}
              </Button>
              <Button
                type="button"
                disabled={submitting}
                onClick={() =>
                  void (step === "preset" ? handleSubmitPreset() : handleSubmitCustom())
                }
              >
                {submitting ? "提交中…" : "添加并设为当前"}
              </Button>
            </div>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
