import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"
import { IconChevronDown, IconHelpCircle } from "@tabler/icons-react"
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
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@workspace/ui/components/combobox"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { Separator } from "@workspace/ui/components/separator"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"
import { getConfigKv, setManyConfigKv } from "@/api/config-kv"
import {
  CUSTOM_PROVIDER_ID,
  fetchLlmProviders,
  testLlmConnection,
  type LlmProviderCatalogItem,
} from "@/api/model"
import { modelKeys } from "@/lib/query-keys/model"

function resolveInitialProviderId(
  savedProvider: string | null | undefined,
  providers: LlmProviderCatalogItem[],
  apiUrl: string
): string {
  if (savedProvider && savedProvider !== CUSTOM_PROVIDER_ID) {
    return savedProvider
  }
  const matched = providers.find((p) => p.base_url === apiUrl)
  if (matched) return matched.id
  return savedProvider || CUSTOM_PROVIDER_ID
}

function buildModelOptions(
  catalogModels: string[],
  currentModel: string
): string[] {
  const trimmed = currentModel.trim()
  if (trimmed && !catalogModels.includes(trimmed)) {
    return [trimmed, ...catalogModels]
  }
  return catalogModels
}

export function ModelsSettings() {
  const queryClient = useQueryClient()
  const [providers, setProviders] = React.useState<LlmProviderCatalogItem[]>([])
  const [providerId, setProviderId] = React.useState(CUSTOM_PROVIDER_ID)
  const [deepagent_model, setModel] = React.useState("")
  const [apiKey, setApiKey] = React.useState("")
  const [apiUrl, setApiUrl] = React.useState("")
  const [maxInputTokens, setMaxInputTokens] = React.useState("")
  const [advancedOpen, setAdvancedOpen] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [testing, setTesting] = React.useState(false)
  const [lastTestOk, setLastTestOk] = React.useState(false)
  const [lastTestResult, setLastTestResult] = React.useState<{
    provider_id: string
    normalized_base_url: string
    model: string
  } | null>(null)

  React.useEffect(() => {
    const loadModelSettings = async () => {
      try {
        const [catalog, modelKv, apiKeyKv, apiUrlKv, maxInputKv, providerKv] =
          await Promise.all([
            fetchLlmProviders(),
            getConfigKv("DEEPAGENT_MODEL"),
            getConfigKv("OPENAI_API_KEY"),
            getConfigKv("BASE_URL"),
            getConfigKv("MODEL_MAX_INPUT_TOKENS"),
            getConfigKv("LLM_PROVIDER"),
          ])
        setProviders(catalog)
        const url = apiUrlKv?.config_value ?? ""
        setModel(modelKv?.config_value ?? "")
        setApiKey(apiKeyKv?.config_value ?? "")
        setApiUrl(url)
        setMaxInputTokens(maxInputKv?.config_value?.trim() ?? "")
        setProviderId(
          resolveInitialProviderId(providerKv?.config_value, catalog, url)
        )
      } catch {
        toast.error("模型设置加载失败")
      }
    }
    loadModelSettings()
  }, [])

  const handleProviderChange = (nextId: string) => {
    setProviderId(nextId)
    setLastTestOk(false)
    setLastTestResult(null)
    if (nextId === CUSTOM_PROVIDER_ID) return
    const profile = providers.find((p) => p.id === nextId)
    if (!profile) return
    setApiUrl(profile.base_url)
    if (profile.default_models[0]) {
      setModel(profile.default_models[0])
    }
  }

  const handleTestConnection = async () => {
    const isCustom = providerId === CUSTOM_PROVIDER_ID
    if (!isCustom && !apiKey.trim()) {
      toast.error("该供应商需要 API Key")
      return
    }
    if (!apiUrl.trim() && isCustom) {
      toast.error("请先填写 API 地址")
      return
    }
    if (!deepagent_model.trim()) {
      toast.error("请先填写模型名称")
      return
    }

    setTesting(true)
    try {
      const result = await testLlmConnection({
        provider_id: providerId === CUSTOM_PROVIDER_ID ? null : providerId,
        base_url: apiUrl.trim() || undefined,
        api_key: apiKey.trim() || undefined,
        model: deepagent_model.trim(),
      })
      if (result.ok) {
        setLastTestOk(true)
        setLastTestResult({
          provider_id: result.provider_id,
          normalized_base_url: result.normalized_base_url,
          model: result.model,
        })
        setProviderId(result.provider_id)
        setApiUrl(result.normalized_base_url)
        setModel(result.model)
        toast.success(result.message || "连接成功")
      } else {
        setLastTestOk(false)
        setLastTestResult(null)
        toast.error(result.message || "连接失败")
      }
    } catch (err) {
      setLastTestOk(false)
      setLastTestResult(null)
      toast.error(err instanceof Error ? err.message : "连接测试失败")
    } finally {
      setTesting(false)
    }
  }

  const handleSave = async () => {
    const trimmedMaxInput = maxInputTokens.trim()
    if (trimmedMaxInput !== "") {
      const n = Number(trimmedMaxInput)
      if (!Number.isInteger(n) || n <= 0) {
        toast.error("最大输入 Token 须为正整数")
        return
      }
    }

    if (!lastTestOk) {
      const confirmed = window.confirm(
        "尚未测试连接或上次测试未通过，仍要保存吗？错误配置可能导致 Agent 无法对话。"
      )
      if (!confirmed) return
    }

    const resolvedProvider =
      lastTestResult?.provider_id ||
      (providerId === CUSTOM_PROVIDER_ID ? CUSTOM_PROVIDER_ID : providerId)
    const resolvedUrl = lastTestResult?.normalized_base_url || apiUrl
    const resolvedModel = lastTestResult?.model || deepagent_model

    setSaving(true)
    try {
      await setManyConfigKv([
        { key: "LLM_PROVIDER", value: resolvedProvider },
        { key: "DEEPAGENT_MODEL", value: resolvedModel },
        { key: "OPENAI_API_KEY", value: apiKey },
        { key: "BASE_URL", value: resolvedUrl },
        { key: "MODEL_MAX_INPUT_TOKENS", value: trimmedMaxInput },
      ])
      await queryClient.invalidateQueries({
        queryKey: modelKeys.runtimeConfig(),
      })
      toast.success("模型设置已保存，请重启后端使新对话生效")
    } catch {
      toast.error("模型设置保存失败")
    } finally {
      setSaving(false)
    }
  }

  const selectedProfile = providers.find((p) => p.id === providerId)
  const modelOptions = React.useMemo(
    () => buildModelOptions(selectedProfile?.default_models ?? [], deepagent_model),
    [selectedProfile?.default_models, deepagent_model]
  )

  const handleModelChange = (nextModel: string) => {
    setModel(nextModel)
    setLastTestOk(false)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>模型设置</CardTitle>
        <CardDescription>
          选择 LLM 供应商、填写密钥与模型，测试连接后保存
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">供应商</span>
          <Select value={providerId} onValueChange={handleProviderChange}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="选择供应商" />
            </SelectTrigger>
            <SelectContent>
              {providers.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.display_name}
                </SelectItem>
              ))}
              <SelectItem value={CUSTOM_PROVIDER_ID}>自定义</SelectItem>
            </SelectContent>
          </Select>
          {selectedProfile?.suggested_max_input_tokens &&
            !maxInputTokens.trim() && (
              <p className="text-xs text-muted-foreground">
                该供应商建议最大输入 Token 约{" "}
                {selectedProfile.suggested_max_input_tokens}
                ，可在高级选项中填写。
              </p>
            )}
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">默认模型</span>
          <Combobox
            items={modelOptions}
            value={
              modelOptions.includes(deepagent_model) ? deepagent_model : null
            }
            inputValue={deepagent_model}
            onInputValueChange={handleModelChange}
            onValueChange={(value) => {
              if (value != null) {
                handleModelChange(String(value))
              }
            }}
          >
            <ComboboxInput
              className="w-full font-mono text-sm"
              placeholder="例如: deepseek-chat"
              showClear={Boolean(deepagent_model)}
            />
            <ComboboxContent>
              <ComboboxList>
                {modelOptions.map((model) => (
                  <ComboboxItem key={model} value={model} className="font-mono">
                    {model}
                  </ComboboxItem>
                ))}
              </ComboboxList>
              <ComboboxEmpty>无匹配项，可直接输入自定义模型名</ComboboxEmpty>
            </ComboboxContent>
          </Combobox>
          <p className="text-xs text-muted-foreground">
            可从列表选择供应商推荐模型，或直接输入其它模型 ID
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">
            API Key
            {providerId === CUSTOM_PROVIDER_ID && (
              <span className="ml-1 font-normal text-muted-foreground">
                （可选，本地无鉴权可留空）
              </span>
            )}
          </span>
          <input
            type="password"
            placeholder={
              providerId === CUSTOM_PROVIDER_ID ? "无鉴权可留空" : "sk-..."
            }
            className="rounded-md border border-input bg-background px-3 py-2 font-mono text-sm"
            value={apiKey}
            onChange={(e) => {
              setApiKey(e.target.value)
              setLastTestOk(false)
            }}
          />
        </div>

        <div className="flex flex-col gap-2">
          <span className="inline-flex items-center gap-1 text-sm font-medium">
            API 地址
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label="API 地址说明"
                  className="text-muted-foreground/70 transition-colors hover:text-foreground"
                >
                  <IconHelpCircle className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-64 text-[11px]">
                <div>
                  <p>
                    OpenAI 兼容接口根地址，通常以{" "}
                    <span className="font-mono">/v1</span> 结尾。
                  </p>
                  <p className="mt-1.5">
                    选择已知供应商时会自动填入默认地址，一般无需修改；选「自定义」时必填。
                  </p>
                  <p className="mt-1.5">
                    测试连接成功后会自动规范化为最终保存的地址。
                  </p>
                </div>
              </TooltipContent>
            </Tooltip>
          </span>
          <input
            placeholder="https://api.example.com/v1"
            className="rounded-md border border-input bg-background px-3 py-2 font-mono text-sm"
            value={apiUrl}
            onChange={(e) => {
              setApiUrl(e.target.value)
              setLastTestOk(false)
            }}
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={handleTestConnection}
            disabled={testing || saving}
          >
            {testing ? "测试中..." : "测试连接"}
          </Button>
          {lastTestOk && (
            <span className="self-center text-xs text-green-600 dark:text-green-400">
              上次测试已通过
            </span>
          )}
        </div>

        <Separator />

        <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center text-xs text-blue-600 transition-colors hover:text-blue-700 hover:underline dark:text-blue-400 dark:hover:text-blue-300"
            >
              <span className="flex items-center gap-1.5 font-normal">
                <IconChevronDown
                  className={cn(
                    "size-3.5 shrink-0 transition-transform",
                    advancedOpen && "rotate-180"
                  )}
                />
                高级选项
              </span>
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="flex flex-col gap-3 pt-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="model-max-input-tokens">
                最大输入 Token 数（MODEL_MAX_INPUT_TOKENS）
              </Label>
              <Input
                id="model-max-input-tokens"
                type="number"
                min={1}
                step={1}
                placeholder="131072"
                className="font-mono text-sm"
                value={maxInputTokens}
                onChange={(e) => setMaxInputTokens(e.target.value)}
              />
              <p className="text-xs leading-relaxed text-muted-foreground">
                用于控制 Agent 上下文压缩的预算（约在达到该值的 75%
                时自动摘要）。留空并保存时，服务端使用默认值 131072。请填写
                <span className="font-medium text-foreground">
                  不高于推理服务实际上下文
                </span>
                的数值，并预留一部分给模型输出，避免 input 超限 400。
              </p>
              <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                <p className="mb-1.5 font-medium text-foreground">
                  推理上下文 → 推荐填写值（参考）
                </p>
                <ul className="list-inside list-disc space-y-0.5 font-mono">
                  <li>20K→ 16000</li>
                  <li>32K → 28000</li>
                  <li>128K → 120000</li>
                  <li>200K → 184000</li>
                </ul>
                <p className="mt-1.5 font-sans">
                  以上为 input 侧预算估算（已扣除输出与安全余量），与推理端的
                  max-model-len 不是同一配置项。
                </p>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                保存后请重启后端，新的对话才会稳定生效。
              </p>
            </div>
          </CollapsibleContent>
        </Collapsible>

        <Button onClick={handleSave} className="mt-2" disabled={saving}>
          {saving ? "保存中..." : "保存设置"}
        </Button>
      </CardContent>
    </Card>
  )
}
