import * as React from "react"
import { IconPlus } from "@tabler/icons-react"
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
import { cn } from "@workspace/ui/lib/utils"
import {
  testLlmConnection,
  updateLlmProvider,
  type LlmRegistry,
  type LlmRegistryProvider,
  type RegistryModelInput,
} from "@/api/model"

function modelsToInputs(
  models: LlmRegistryProvider["models"]
): RegistryModelInput[] {
  return models.map((m) => ({
    id: m.id,
    display_name: m.display_name,
  }))
}

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

export function EditProviderDialog({
  provider,
  open,
  onOpenChange,
  onSaved,
}: {
  provider: LlmRegistryProvider
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: (registry: LlmRegistry) => void
}) {
  const [displayName, setDisplayName] = React.useState(provider.display_name)
  const [baseUrl, setBaseUrl] = React.useState(provider.base_url)
  const [apiKey, setApiKey] = React.useState("")
  const [models, setModels] = React.useState<RegistryModelInput[]>(() =>
    modelsToInputs(provider.models)
  )
  const [saving, setSaving] = React.useState(false)
  const [testing, setTesting] = React.useState(false)

  React.useEffect(() => {
    setDisplayName(provider.display_name)
    setBaseUrl(provider.base_url)
    setApiKey("")
    setModels(modelsToInputs(provider.models))
  }, [provider])

  const handleTest = async () => {
    const modelId = models[0]?.id?.trim()
    if (!modelId) {
      toast.error("至少保留一个模型")
      return
    }
    setTesting(true)
    try {
      const result = await testLlmConnection({
        provider_id: provider.source === "builtin" ? provider.id : "custom",
        base_url: provider.source === "custom" ? baseUrl.trim() : undefined,
        api_key: apiKey.trim() || undefined,
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

  const handleSave = async () => {
    if (!displayName.trim()) {
      toast.error("显示名称不能为空")
      return
    }
    const normalizedModels = models
      .map((m) => ({
        id: m.id.trim(),
        display_name: m.display_name?.trim() || null,
      }))
      .filter((m) => m.id)
    if (normalizedModels.length === 0) {
      toast.error("至少需要一个模型")
      return
    }

    setSaving(true)
    try {
      const next = await updateLlmProvider(provider.id, {
        display_name: displayName.trim(),
        base_url: provider.source === "custom" ? baseUrl.trim() : undefined,
        api_key: apiKey.trim() || undefined,
        api_key_unchanged: !apiKey.trim(),
        models: normalizedModels,
      })
      onSaved(next)
      toast.success("已保存")
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败")
    } finally {
      setSaving(false)
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
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="space-y-1 border-b px-6 py-4">
          <DialogTitle>编辑 {provider.display_name}</DialogTitle>
          <DialogDescription className="font-mono text-xs">
            {provider.base_url}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[min(60vh,26rem)] overflow-y-auto px-6 py-4">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label>显示名称</Label>
              <Input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </div>
            {provider.source === "custom" && (
              <div className="flex flex-col gap-2">
                <Label>API 地址</Label>
                <Input
                  className="font-mono text-sm"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                />
              </div>
            )}
            <div className="flex flex-col gap-2">
              <Label>
                API Key
                {provider.api_key_present && (
                  <span className="ml-1 font-normal text-muted-foreground">
                    （留空保留 {provider.api_key_masked}）
                  </span>
                )}
              </Label>
              <PasswordInput
                placeholder={provider.api_key_present ? "留空不修改" : "sk-..."}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
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
                  <div
                    key={index}
                    className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]"
                  >
                    <Input
                      className="font-mono text-sm"
                      placeholder="model-id"
                      value={model.id}
                      onChange={(e) =>
                        updateModelRow(index, "id", e.target.value)
                      }
                    />
                    <Input
                      placeholder="显示名称（可选）"
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
        </div>

        <DialogFooter className="gap-2 border-t bg-muted/20 px-6 py-4 sm:justify-between">
          <Button
            type="button"
            variant="outline"
            onClick={() => void handleTest()}
            disabled={testing || saving}
          >
            {testing ? "测试中…" : "测试连接"}
          </Button>
          <Button type="button" onClick={() => void handleSave()} disabled={saving}>
            {saving ? "保存中…" : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
