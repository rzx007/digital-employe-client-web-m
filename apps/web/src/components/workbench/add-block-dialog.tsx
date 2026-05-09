import * as React from "react"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Textarea } from "@workspace/ui/components/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { Checkbox } from "@workspace/ui/components/checkbox"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { IconRefresh } from "@tabler/icons-react"
import { cn } from "@workspace/ui/lib/utils"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import type { MetadataSkill } from "@/api/types"
import type { ChartDisplayType, QueryInterface } from "@/types/workbench"
import { parseInterfacesFromSkills } from "@/lib/workbench/query-interface-parser"
import {
  getCachedParsedInterfaces,
  getSkillInterfacesCacheKey,
  invalidateSkillInterfacesCache,
  setCachedParsedInterfaces,
} from "@/lib/workbench/skill-interfaces-cache"
import {
  detectResponseFormat,
  extractBaseUrlFromPath,
  normalizeQueryInterfaceForRequest,
} from "@/lib/workbench/query-interface-resolve"
import { mergeHeadersJsonOverride } from "@/lib/workbench/http-headers"
import { analyzeResponseFields, fetchSampleData } from "@/lib/workbench/response-field-analyzer"
import { DataVisualizer } from "./data-visualizer"

interface AddBlockDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  skills: MetadataSkill[]
  /** localStorage 工作台缓存键用，如 global */
  employeeId: string
  /** POST /chat/send 必填整数 employee_id，工作台传入首位可用员工 */
  chatEmployeeId?: number | null
  onAdd: (interfaces: QueryInterface[]) => void
}

const CHART_TYPES: { value: ChartDisplayType; label: string; icon: string }[] = [
  { value: "bar", label: "柱状图", icon: "📊" },
  { value: "pie", label: "饼图", icon: "🥧" },
  { value: "line", label: "折线图", icon: "📈" },
  { value: "table", label: "表格", icon: "📋" },
  { value: "metric", label: "数值", icon: "🔢" },
  { value: "list", label: "列表", icon: "📃" },
]

function skillSelectKey(s: MetadataSkill, i: number): string {
  const row = s as MetadataSkill & { workbenchRowKey?: string }
  if (row.workbenchRowKey) return row.workbenchRowKey
  return `${s.directoryName ?? ""}::${String(s.id ?? s.skillName)}::${i}`
}

function skillOptionLabel(s: MetadataSkill): string {
  const row = s as MetadataSkill & { workbenchSkillLabel?: string }
  if (row.workbenchSkillLabel) return row.workbenchSkillLabel
  return s.directoryName
    ? `${s.skillName} · ${s.directoryName}`
    : s.skillName
}

export function AddBlockDialog({
  open,
  onOpenChange,
  skills,
  employeeId,
  chatEmployeeId,
  onAdd,
}: AddBlockDialogProps) {
  const [selectedSkillKey, setSelectedSkillKey] = React.useState<string>("")
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set())
  const [interfaces, setInterfaces] = React.useState<QueryInterface[]>([])
  const [isLoading, setIsLoading] = React.useState(false)
  const [baseUrlOverrides, setBaseUrlOverrides] = React.useState<Record<string, string>>({})
  const [chartTypeSelections, setChartTypeSelections] = React.useState<Record<string, ChartDisplayType>>({})
  /** Extra JSON object merged into iface.headers for preview & save */
  const [headersJsonOverrides, setHeadersJsonOverrides] = React.useState<Record<string, string>>({})

  /** 切换技能或关闭弹窗时中止上一轮的解析请求（/chat/send） */
  const parseAbortRef = React.useRef<AbortController | null>(null)

  const selectedSkill = React.useMemo(() => {
    if (skills.length === 0) return null
    if (!selectedSkillKey) return skills[0]
    const found = skills.find(
      (s, i) => skillSelectKey(s, i) === selectedSkillKey,
    )
    return found ?? skills[0]
  }, [skills, selectedSkillKey])

  const cacheKey = React.useMemo(
    () => getSkillInterfacesCacheKey(employeeId, skills, selectedSkill),
    [employeeId, skills, selectedSkill],
  )

  const applyChartDefaults = React.useCallback((list: QueryInterface[]) => {
    const defaults: Record<string, ChartDisplayType> = {}
    list.forEach((iface) => {
      defaults[iface.id] = iface.chartType || "bar"
    })
    setChartTypeSelections(defaults)
  }, [])

  const loadInterfaces = React.useCallback(
    async (forceRefresh: boolean) => {
      if (skills.length === 0 || !selectedSkill) {
        setInterfaces([])
        return
      }
      if (forceRefresh) {
        invalidateSkillInterfacesCache(cacheKey)
      }
      if (!forceRefresh) {
        const cached = getCachedParsedInterfaces(cacheKey)
        if (cached) {
          setInterfaces(cached)
          applyChartDefaults(cached)
          return
        }
      }
      parseAbortRef.current?.abort()
      const ac = new AbortController()
      parseAbortRef.current = ac

      setIsLoading(true)
      try {
        const parsed = await parseInterfacesFromSkills(
          employeeId,
          [selectedSkill],
          chatEmployeeId,
          { signal: ac.signal },
        )
        if (parseAbortRef.current !== ac) return
        setCachedParsedInterfaces(cacheKey, parsed)
        setInterfaces(parsed)
        applyChartDefaults(parsed)
      } catch (e) {
        if (
          e &&
          typeof e === "object" &&
          (e as { name?: string }).name === "AbortError"
        ) {
          return
        }
        console.error("Failed to load interfaces:", e)
      } finally {
        if (parseAbortRef.current === ac) {
          setIsLoading(false)
        }
      }
    },
    [
      employeeId,
      selectedSkill,
      skills.length,
      cacheKey,
      applyChartDefaults,
      chatEmployeeId,
    ],
  )

  React.useEffect(() => {
    if (!open) {
      parseAbortRef.current?.abort()
      parseAbortRef.current = null
    }
  }, [open])

  React.useEffect(() => {
    if (!open || skills.length === 0) return
    setSelectedSkillKey((prev) => {
      const valid =
        prev && skills.some((s, i) => skillSelectKey(s, i) === prev)
      if (valid && prev) return prev
      return skillSelectKey(skills[0], 0)
    })
  }, [open, skills])

  React.useEffect(() => {
    if (!open) return
    setSelectedIds(new Set())
    setInterfaces([])
    setBaseUrlOverrides({})
    setChartTypeSelections({})
    setHeadersJsonOverrides({})
  }, [open, cacheKey])

  React.useEffect(() => {
    if (!open) return
    void loadInterfaces(false)
  }, [open, cacheKey, loadInterfaces])

  /** 切换所选技能时强制重新解析（仅当前选中技能） */
  const skipSelectReparse = React.useRef(true)
  React.useEffect(() => {
    if (!open) {
      skipSelectReparse.current = true
      return
    }
    if (skills.length === 0 || !selectedSkillKey) return
    if (skipSelectReparse.current) {
      skipSelectReparse.current = false
      return
    }
    setSelectedIds(new Set())
    setBaseUrlOverrides({})
    setChartTypeSelections({})
    setHeadersJsonOverrides({})
    void loadInterfaces(true)
    // Intentionally omit skills.length: list updates from API should refresh via cacheKey, not this branch.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- selection-change reparsing only
  }, [open, selectedSkillKey, loadInterfaces])

  const handleToggle = (id: string) => {
    const newSelected = new Set(selectedIds)
    if (newSelected.has(id)) {
      newSelected.delete(id)
    } else {
      newSelected.add(id)
    }
    setSelectedIds(newSelected)
  }

  const handleBaseUrlChange = (id: string, value: string) => {
    setBaseUrlOverrides((prev) => ({ ...prev, [id]: value }))
  }

  const handleChartTypeChange = (id: string, chartType: ChartDisplayType) => {
    setChartTypeSelections((prev) => ({ ...prev, [id]: chartType }))
  }

  const handleAdd = async () => {
    const selectedInterfaces = interfaces.filter((i) => selectedIds.has(i.id))

    // Enrich each interface with baseUrl, path, chartType, and AI-analyzed field binding
    const enriched: QueryInterface[] = []

    for (const iface of selectedInterfaces) {
      const chartType = chartTypeSelections[iface.id] || "bar"

      // Create interface with current config (same URL rules as preview)
      const configIface: QueryInterface = {
        ...normalizeQueryInterfaceForRequest(iface, baseUrlOverrides[iface.id]),
        chartType,
        headers: mergeHeadersJsonOverride(iface.headers, headersJsonOverrides[iface.id]),
      }

      // Fetch sample data first
      let sampleData = null
      try {
        sampleData = await fetchSampleData(configIface)
      } catch (e) {
        console.error("Failed to fetch sample data:", e)
      }

      // Always detect/verify responseFormat from sample data
      if (sampleData) {
        const detectedResponseFormat = detectResponseFormat(sampleData)
        // Use detected format if original is empty, or if detection found a nested path
        if (detectedResponseFormat) {
          configIface.responseFormat = detectedResponseFormat
        }
      }

      if (sampleData) {
        try {
          const fieldBinding = await analyzeResponseFields(configIface, sampleData)
          configIface.fieldBinding = fieldBinding
        } catch (e) {
          console.error("Failed to analyze response fields:", e)
        }
      }

      enriched.push(configIface)
    }

    onAdd(enriched)
    setSelectedIds(new Set())
    setSelectedSkillKey("")
    setInterfaces([])
    setBaseUrlOverrides({})
    setChartTypeSelections({})
    setHeadersJsonOverrides({})
    onOpenChange(false)
  }

  const handleClose = () => {
    setSelectedIds(new Set())
    setSelectedSkillKey("")
    setInterfaces([])
    setBaseUrlOverrides({})
    setChartTypeSelections({})
    setHeadersJsonOverrides({})
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="flex max-h-[85vh] min-h-0 max-w-3xl flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="shrink-0 space-y-1 border-b border-border/60 bg-muted/20 px-6 py-4 text-left">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-1">
              <DialogTitle className="text-base font-semibold tracking-tight">添加数据模块</DialogTitle>
              <DialogDescription className="text-xs leading-relaxed">
                下方列表为全部技能中解析出的接口；切换上方技能将重新从全部技能解析；勾选后可配置地址与图表并预览（列表已缓存，可点刷新）
              </DialogDescription>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0 gap-1.5 text-xs"
              disabled={isLoading}
              onClick={() => void loadInterfaces(true)}
              title="重新从技能解析接口列表"
            >
              <IconRefresh className={cn("size-3.5", isLoading && "animate-spin")} />
              刷新
            </Button>
          </div>
        </DialogHeader>

        <div className="shrink-0 border-b border-border/60 bg-muted/10 px-6 py-3">
          <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            选择技能（切换后将重新解析全部技能中的接口）
          </label>
          <Select
            value={
              selectedSkillKey ||
              (skills[0] ? skillSelectKey(skills[0], 0) : undefined)
            }
            onValueChange={setSelectedSkillKey}
            disabled={skills.length === 0}
          >
            <SelectTrigger className="h-8 w-full">
              <SelectValue placeholder="请选择技能" />
            </SelectTrigger>
            <SelectContent
              position="popper"
              sideOffset={4}
              collisionPadding={8}
              className="z-[200] max-h-[min(50vh,360px)] w-[var(--radix-select-trigger-width)]"
            >
              {skills.map((s, i) => (
                <SelectItem key={skillSelectKey(s, i)} value={skillSelectKey(s, i)}>
                  <span className="text-sm">{skillOptionLabel(s)}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-24 w-full rounded-xl" />
              ))}
            </div>
          ) : interfaces.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/80 bg-muted/15 py-12 text-center">
              <p className="text-sm text-muted-foreground">未从技能中发现查询接口</p>
              <p className="mt-1 px-4 text-xs text-muted-foreground/80">
                请在技能 Prompt 中写明以 http:// 或 https:// 开头的完整接口地址
              </p>
            </div>
          ) : (
            <div className="space-y-3 pr-1">
                {interfaces.map((iface) => (
                  <div
                    key={iface.id}
                    className={cn(
                      "rounded-xl border p-4 transition-all",
                      selectedIds.has(iface.id)
                        ? "border-primary/60 bg-primary/[0.06] shadow-sm ring-1 ring-primary/15"
                        : "border-border/80 bg-card/40 hover:border-border hover:bg-muted/25"
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <Checkbox
                        checked={selectedIds.has(iface.id)}
                        onCheckedChange={() => handleToggle(iface.id)}
                        className="mt-0.5"
                      />
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-sm leading-snug">{iface.name}</span>
                        </div>
                        <p className="text-xs leading-relaxed text-muted-foreground">
                          {iface.description || "无描述"}
                        </p>
                        <p className="break-all rounded-md bg-muted/50 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-muted-foreground">
                          {iface.path}
                        </p>

                        {selectedIds.has(iface.id) && (
                          <div className="space-y-2 pt-1">
                            {/* Chart type selection */}
                            <div>
                              <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                展示形式
                              </label>
                              <div className="flex flex-wrap gap-1.5">
                                {CHART_TYPES.map((ct) => (
                                  <button
                                    key={ct.value}
                                    type="button"
                                    onClick={() => handleChartTypeChange(iface.id, ct.value)}
                                    className={cn(
                                      "flex min-h-8 flex-1 items-center justify-center gap-1 rounded-lg border px-2 py-1.5 text-xs transition-colors",
                                      chartTypeSelections[iface.id] === ct.value
                                        ? "border-primary bg-primary text-primary-foreground shadow-sm"
                                        : "border-border/80 bg-background hover:bg-muted/80"
                                    )}
                                  >
                                    <span>{ct.icon}</span>
                                    <span>{ct.label}</span>
                                  </button>
                                ))}
                              </div>
                            </div>

                            {/* Server URL */}
                            <div>
                              <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                服务器地址（可选覆盖）
                              </label>
                              <Input
                                placeholder={
                                  iface.path.startsWith("http")
                                    ? extractBaseUrlFromPath(iface.path)
                                    : "http://192.168.1.100:8080"
                                }
                                value={baseUrlOverrides[iface.id] || ""}
                                onChange={(e) =>
                                  handleBaseUrlChange(iface.id, e.target.value)
                                }
                                className="h-8 text-xs font-mono"
                              />
                            </div>

                            <div>
                              <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                请求头（JSON，可选）
                              </label>
                              <Textarea
                                placeholder='{"Authorization":"Bearer …"}'
                                value={headersJsonOverrides[iface.id] ?? ""}
                                onChange={(e) =>
                                  setHeadersJsonOverrides((prev) => ({
                                    ...prev,
                                    [iface.id]: e.target.value,
                                  }))
                                }
                                className="min-h-[52px] font-mono text-[11px] leading-relaxed"
                                rows={2}
                              />
                              <p className="mt-1 text-[10px] text-muted-foreground">
                                与技能解析出的请求头合并；预览与添加后请求均会带上
                              </p>
                            </div>

                            {/* Preview */}
                            <div>
                              <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                预览
                              </label>
                              <div
                                className="overflow-hidden rounded-lg border border-border/80 bg-muted/20 ring-1 ring-border/30"
                                style={{ height: "140px" }}
                              >
                                <DataVisualizer
                                  queryInterface={{
                                    ...normalizeQueryInterfaceForRequest(iface, baseUrlOverrides[iface.id]),
                                    chartType: chartTypeSelections[iface.id] || "bar",
                                    headers: mergeHeadersJsonOverride(
                                      iface.headers,
                                      headersJsonOverrides[iface.id]
                                    ),
                                  }}
                                  className="text-xs"
                                  title={iface.name}
                                  embedded
                                />
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0 border-t border-border/60 bg-muted/10 px-6 py-3 sm:justify-end">
          <Button variant="outline" onClick={handleClose}>
            取消
          </Button>
          <Button onClick={handleAdd} disabled={selectedIds.size === 0}>
            添加 ({selectedIds.size})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
