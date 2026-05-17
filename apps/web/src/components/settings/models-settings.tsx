import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"
import { IconChevronDown } from "@tabler/icons-react"
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
import { cn } from "@workspace/ui/lib/utils"
import { getConfigKv, setManyConfigKv } from "@/api/config-kv"
import { modelKeys } from "@/lib/query-keys/model"

export function ModelsSettings() {
  const queryClient = useQueryClient()
  const [deepagent_model, setModel] = React.useState("")
  const [apiKey, setApiKey] = React.useState("")
  const [apiUrl, setApiUrl] = React.useState("")
  const [maxInputTokens, setMaxInputTokens] = React.useState("")
  const [advancedOpen, setAdvancedOpen] = React.useState(false)
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    const loadModelSettings = async () => {
      try {
        const [modelKv, apiKeyKv, apiUrlKv, maxInputKv] = await Promise.all([
          getConfigKv("DEEPAGENT_MODEL"),
          getConfigKv("OPENAI_API_KEY"),
          getConfigKv("BASE_URL"),
          getConfigKv("MODEL_MAX_INPUT_TOKENS"),
        ])
        setModel(modelKv?.config_value ?? "")
        setApiKey(apiKeyKv?.config_value ?? "")
        setApiUrl(apiUrlKv?.config_value ?? "")
        setMaxInputTokens(maxInputKv?.config_value?.trim() ?? "")
      } catch {
        toast.error("模型设置加载失败")
      }
    }
    loadModelSettings()
  }, [])

  const handleSave = async () => {
    const trimmedMaxInput = maxInputTokens.trim()
    if (trimmedMaxInput !== "") {
      const n = Number(trimmedMaxInput)
      if (!Number.isInteger(n) || n <= 0) {
        toast.error("最大输入 Token 须为正整数")
        return
      }
    }

    setSaving(true)
    try {
      await setManyConfigKv([
        { key: "DEEPAGENT_MODEL", value: deepagent_model },
        { key: "OPENAI_API_KEY", value: apiKey },
        { key: "BASE_URL", value: apiUrl },
        { key: "MODEL_MAX_INPUT_TOKENS", value: trimmedMaxInput },
      ])
      await queryClient.invalidateQueries({
        queryKey: modelKeys.runtimeConfig(),
      })
      toast.success("模型设置已保存")
    } catch {
      toast.error("模型设置保存失败")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          模型设置
          <em className="ml-2 text-xs text-muted-foreground">开发中...</em>
        </CardTitle>
        <CardDescription>配置 AI 模型相关选项</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">默认模型</span>
          <Input
            placeholder="例如: google/gemma-4-26b-a4b"
            className="font-mono text-sm"
            value={deepagent_model}
            onChange={(e) => setModel(e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">API Key</span>
          <input
            type="password"
            placeholder="sk-..."
            className="rounded-md border border-input bg-background px-3 py-2 font-mono text-sm"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">API 地址</span>
          <input
            placeholder="https://api.example.com"
            className="rounded-md border border-input bg-background px-3 py-2 font-mono text-sm"
            value={apiUrl}
            onChange={(e) => setApiUrl(e.target.value)}
          />
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
                    advancedOpen && "rotate-180",
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
                用于控制 Agent 上下文压缩的预算（约在达到该值的 85%
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
