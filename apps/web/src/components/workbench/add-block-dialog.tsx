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
import {
  analyzeResponseFields,
  fetchSampleData,
} from "@/lib/workbench/response-field-analyzer"
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

const CHART_TYPES: { value: ChartDisplayType; label: string; icon: string }[] =
  [
    { value: "bar", label: "柱状图", icon: "📊" },
    { value: "pie", label: "饼图", icon: "🥧" },
    { value: "line", label: "折线图", icon: "📈" },
    { value: "table", label: "表格", icon: "📋" },
    { value: "metric", label: "数值", icon: "🔢" },
    { value: "list", label: "列表", icon: "📃" },
  ]

type WorkbenchSelectSkill = MetadataSkill & {
  displayNameZh?: string | null
  workbenchSource?: "local" | "builtin"
  workbenchSkillLabel?: string
  workbenchRowKey?: string
}

/** 列表展示：优先中文名，无则英文名 */
function skillTitleZh(s: MetadataSkill): string {
  const r = s as WorkbenchSelectSkill
  const zh = r.displayNameZh?.trim()
  if (zh) return zh
  return s.skillName
}

function workbenchSourceFromSkill(s: MetadataSkill): "local" | "builtin" {
  const r = s as WorkbenchSelectSkill
  if (r.workbenchSource === "builtin") return "builtin"
  if (r.workbenchSource === "local") return "local"
  if (s.directoryName?.includes("内置")) return "builtin"
  if (s.directoryName?.includes("本地")) return "local"
  return "local"
}

function skillSourceLabel(src: "local" | "builtin"): string {
  return src === "builtin" ? "内置技能" : "本地技能"
}

function SkillSelectRow({ skill }: { skill: MetadataSkill }) {
  const title = skillTitleZh(skill)
  const src = workbenchSourceFromSkill(skill)
  return (
    <span className="flex max-w-full min-w-0 items-center gap-1.5">
      <span
        className="min-w-0 flex-1 truncate"
        title={title !== skill.skillName ? skill.skillName : undefined}
      >
        {title}
      </span>
      <span
        className={cn(
          "size-1.5 shrink-0 rounded-full ring-1 ring-background",
          src === "builtin" ? "bg-amber-500" : "bg-sky-500"
        )}
        title={skillSourceLabel(src)}
        aria-hidden
      />
    </span>
  )
}

function skillSelectKey(s: MetadataSkill, i: number): string {
  const row = s as MetadataSkill & { workbenchRowKey?: string }
  if (row.workbenchRowKey) return row.workbenchRowKey
  return `${s.directoryName ?? ""}::${String(s.id ?? s.skillName)}::${i}`
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
  const [baseUrlOverrides, setBaseUrlOverrides] = React.useState<
    Record<string, string>
  >({})
  const [chartTypeSelections, setChartTypeSelections] = React.useState<
    Record<string, ChartDisplayType>
  >({})
  /** Extra JSON object merged into iface.headers for preview & save */
  const [headersJsonOverrides, setHeadersJsonOverrides] = React.useState<
    Record<string, string>
  >({})

  /** 切换技能或关闭弹窗时中止上一轮的解析请求（/chat/send） */
  const parseAbortRef = React.useRef<AbortController | null>(null)

  const selectedSkill = React.useMemo(() => {
    if (skills.length === 0) return null
    if (!selectedSkillKey) return skills[0]
    const found = skills.find(
      (s, i) => skillSelectKey(s, i) === selectedSkillKey
    )
    return found ?? skills[0]
  }, [skills, selectedSkillKey])

  const cacheKey = React.useMemo(
    () => getSkillInterfacesCacheKey(employeeId, skills, selectedSkill),
    [employeeId, skills, selectedSkill]
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
      setInterfaces([])
      parseAbortRef.current?.abort()
      const ac = new AbortController()
      parseAbortRef.current = ac

      setIsLoading(true)
      try {
        const parsed = await parseInterfacesFromSkills(
          employeeId,
          [selectedSkill],
          chatEmployeeId,
          { signal: ac.signal }
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
    ]
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
      const valid = prev && skills.some((s, i) => skillSelectKey(s, i) === prev)
      if (valid && prev) return prev
      return skillSelectKey(skills[0], 0)
    })
  }, [open, skills])

  React.useEffect(() => {
    if (!open) return
    setSelectedIds(new Set())
    setBaseUrlOverrides({})
    setChartTypeSelections({})
    setHeadersJsonOverrides({})
  }, [open, cacheKey])

  React.useEffect(() => {
    if (!open) return
    void loadInterfaces(false)
  }, [open, cacheKey, loadInterfaces])

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
        headers: mergeHeadersJsonOverride(
          iface.headers,
          headersJsonOverrides[iface.id]
        ),
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
          const fieldBinding = await analyzeResponseFields(
            configIface,
            sampleData
          )
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
              <DialogTitle className="text-base font-semibold tracking-tight">
                添加数据模块
              </DialogTitle>
              <DialogDescription className="text-xs leading-relaxed">
                下方列表为当前技能解析出的接口（技能来源：工作空间本地技能与内置技能，不含远程平台技能）；切换技能优先读缓存，不会重复消耗 Token；需重新解析时点右上角「刷新」；勾选后可配置地址与图表并预览
              </DialogDescription>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0 gap-1.5 text-xs"
              disabled={isLoading}
              onClick={() => void loadInterfaces(true)}
              title="忽略缓存，重新调用 AI 解析当前技能的接口列表"
            >
              <IconRefresh
                className={cn("size-3.5", isLoading && "animate-spin")}
              />
              刷新
            </Button>
          </div>
        </DialogHeader>

        <div className="shrink-0 border-b border-border/60 bg-muted/10 px-6 py-3">
          <label className="mb-1.5 block text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            选择技能
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
                <SelectItem
                  key={skillSelectKey(s, i)}
                  value={skillSelectKey(s, i)}
                  textValue={`${skillTitleZh(s)} ${s.skillName}`}
                >
                  <SkillSelectRow skill={s} />
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
              <p className="text-sm text-muted-foreground">
                未从技能中发现查询接口
              </p>
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
                        <span className="text-sm leading-snug font-medium">
                          {iface.name}
                        </span>
                      </div>
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        {iface.description || "无描述"}
                      </p>
                      <p className="rounded-md bg-muted/50 px-2 py-1.5 font-mono text-[11px] leading-relaxed break-all text-muted-foreground">
                        {iface.path}
                      </p>

                      {selectedIds.has(iface.id) && (
                        <div className="space-y-2 pt-1">
                          {/* Chart type selection */}
                          <div>
                            <label className="mb-1.5 block text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                              展示形式
                            </label>
                            <div className="flex flex-wrap gap-1.5">
                              {CHART_TYPES.map((ct) => (
                                <button
                                  key={ct.value}
                                  type="button"
                                  onClick={() =>
                                    handleChartTypeChange(iface.id, ct.value)
                                  }
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
                            <label className="mb-1.5 block text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
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
                              className="h-8 font-mono text-xs"
                            />
                          </div>

                          <div>
                            <label className="mb-1.5 block text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
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
                            <label className="mb-1.5 block text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                              预览
                            </label>
                            <div
                              className="overflow-hidden rounded-lg border border-border/80 bg-muted/20 ring-1 ring-border/30"
                              style={{ height: "140px" }}
                            >
                              <DataVisualizer
                                queryInterface={{
                                  ...normalizeQueryInterfaceForRequest(
                                    iface,
                                    baseUrlOverrides[iface.id]
                                  ),
                                  chartType:
                                    chartTypeSelections[iface.id] || "bar",
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
