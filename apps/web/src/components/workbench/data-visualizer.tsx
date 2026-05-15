import { useState, useEffect, useCallback } from "react"
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  LineChart,
  Line,
  Legend,
  ResponsiveContainer,
  Tooltip,
} from "recharts"
import { cn } from "@workspace/ui/lib/utils"
import { Button } from "@workspace/ui/components/button"
import { IconRefresh, IconLoader } from "@tabler/icons-react"
import type { ChartDisplayType, QueryInterface } from "@/types/workbench"
import { detectResponseFormat } from "@/lib/workbench/query-interface-resolve"
import { buildFetchHeadersInit } from "@/lib/workbench/http-headers"
import { buildFetchUrlFromInterface } from "@/lib/workbench/url-template-params"
import {
  inferLabelKey,
  inferNumericKeys,
  isNumericLike,
  parseResponseData,
  type ParsedResponseRows,
} from "@/lib/workbench/parse-response-rows"

interface DataVisualizerProps {
  queryInterface: QueryInterface
  className?: string
  title?: string
  /** 嵌入工作台卡片时使用更紧凑的顶栏样式 */
  embedded?: boolean
}

type ChartType = "pie" | "bar" | "line" | "table" | "json" | "unknown"

type ParsedData = ParsedResponseRows

function toNumeric(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v
  if (typeof v === "string") {
    const n = Number(v.trim())
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

const CHART_DISPLAY_TYPES: ChartDisplayType[] = ["pie", "bar", "line", "table", "metric", "list"]

/** 兼容旧配置中的 custom；非法值回退为柱状图 */
function coerceSavedChartType(raw: string | undefined): ChartDisplayType | undefined {
  if (!raw) return undefined
  if (raw === "custom") return "bar"
  return CHART_DISPLAY_TYPES.includes(raw as ChartDisplayType) ? (raw as ChartDisplayType) : "bar"
}

/** 常见英文字段名 → 中文图例/表头（接口字段为中文时原样返回） */
const FIELD_LABEL_ZH: Record<string, string> = {
  name: "名称",
  title: "标题",
  label: "标签",
  value: "数值",
  values: "数值",
  amount: "金额",
  count: "数量",
  total: "合计",
  sum: "合计",
  avg: "平均值",
  average: "平均值",
  min: "最小值",
  max: "最大值",
  date: "日期",
  time: "时间",
  datetime: "日期时间",
  day: "日",
  month: "月",
  year: "年",
  category: "类别",
  type: "类型",
  status: "状态",
  id: "编号",
  key: "键",
  price: "价格",
  quantity: "数量",
  sales: "销售额",
  revenue: "收入",
  cost: "成本",
  profit: "利润",
  rate: "比率",
  percent: "百分比",
  percentage: "百分比",
  ratio: "比例",
  score: "得分",
  weight: "权重",
  num: "数量",
  index: "序号",
  order: "排序",
  desc: "描述",
  description: "描述",
  remark: "备注",
  unit: "单位",
  code: "编码",
  area: "区域",
  region: "地区",
  city: "城市",
  user: "用户",
  owner: "负责人",
}

function translateFieldLabel(key: string): string {
  const t = key.trim()
  if (/[\u4e00-\u9fff]/.test(t)) return t
  const lower = t.toLowerCase()
  if (FIELD_LABEL_ZH[lower]) return FIELD_LABEL_ZH[lower]
  const noUnderscore = lower.replace(/_/g, "")
  if (FIELD_LABEL_ZH[noUnderscore]) return FIELD_LABEL_ZH[noUnderscore]
  return t
}

/** 优先使用技能正文解析出的 fieldLabels，否则回退到内置英→中映射 */
function resolveFieldLabel(key: string, fieldLabels?: Record<string, string>): string {
  const fromSkill = fieldLabels?.[key]
  if (typeof fromSkill === "string" && fromSkill.trim()) return fromSkill.trim()
  return translateFieldLabel(key)
}

function formatTooltipNumber(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value.toLocaleString("zh-CN", { maximumFractionDigits: 6 })
  }
  return String(value ?? "")
}

const chartTooltipShared = {
  formatter: (value: unknown, name: string) =>
    [formatTooltipNumber(value), name] as [string, string],
  labelFormatter: (label: unknown) => (label != null && label !== "" ? `类别：${label}` : ""),
}

const chartLegendShared = {
  formatter: (value: string) => value,
}

function formatDataLoadError(e: unknown): string {
  if (!(e instanceof Error)) return "加载失败"
  const m = e.message
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) {
    return "网络异常，请检查连接后重试"
  }
  const http = /^HTTP (\d+)\s*:\s*(.*)$/i.exec(m)
  if (http) {
    const status = http[1]
    const rest = http[2]?.trim() || ""
    return rest ? `请求失败（${status}：${rest}）` : `请求失败（${status}）`
  }
  return m || "加载失败"
}

function formatMetricCell(v: unknown): string {
  const n = toNumeric(v)
  if (!Number.isFinite(n)) return "—"
  return n.toLocaleString("zh-CN", { maximumFractionDigits: 6 })
}

function DataMetricView({
  headers,
  rows,
  fieldBinding,
  fieldLabels,
}: {
  headers: string[]
  rows: Record<string, unknown>[]
  fieldBinding?: QueryInterface["fieldBinding"]
  fieldLabels?: Record<string, string>
}) {
  if (rows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">暂无数据</div>
    )
  }

  const inferred = inferNumericKeys(headers, rows)
  let keys: string[] = []
  if (fieldBinding?.valueFields?.length) {
    keys = fieldBinding.valueFields.filter((k) => headers.includes(k) && inferred.includes(k))
  }
  if (keys.length === 0) keys = inferred
  if (keys.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-2 text-center text-xs text-muted-foreground">
        未识别到数值字段
      </div>
    )
  }
  const row = rows[0]
  if (!row) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">暂无数据</div>
    )
  }
  return (
    <div className="flex h-full flex-col overflow-auto p-2">
      <div
        className={cn(
          "flex flex-1 flex-wrap content-center items-center justify-center gap-2",
          keys.length === 1 && "items-stretch"
        )}
      >
        {keys.map((k) => (
          <div
            key={k}
            className={cn(
              "min-w-0 flex-1 rounded-lg border border-border/60 bg-muted/25 px-3 py-2 text-center",
              keys.length === 1 && "max-w-[220px]"
            )}
          >
            <div className="truncate text-[10px] font-medium text-muted-foreground">
              {resolveFieldLabel(k, fieldLabels)}
            </div>
            <div
              className={cn(
                "mt-0.5 font-semibold tabular-nums text-foreground",
                keys.length === 1 ? "text-2xl" : "text-base"
              )}
            >
              {formatMetricCell(row[k])}
            </div>
          </div>
        ))}
      </div>
      {rows.length > 1 && (
        <p className="mt-1 shrink-0 text-center text-[10px] text-muted-foreground">
          共 {rows.length} 条，展示首条记录的数值
        </p>
      )}
    </div>
  )
}

function DataListView({
  headers,
  rows,
  fieldBinding,
  fieldLabels,
}: {
  headers: string[]
  rows: Record<string, unknown>[]
  fieldBinding?: QueryInterface["fieldBinding"]
  fieldLabels?: Record<string, string>
}) {
  const inferred = inferNumericKeys(headers, rows)
  const numericSet = new Set(inferred)
  const labelKey =
    fieldBinding?.labelField && headers.includes(fieldBinding.labelField)
      ? fieldBinding.labelField
      : inferLabelKey(headers, rows, numericSet)
  const detailKeys = headers.filter((h) => h !== labelKey)
  const maxRows = 100
  const slice = rows.slice(0, maxRows)

  if (rows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">暂无数据</div>
    )
  }

  return (
    <ul className="h-full space-y-1.5 overflow-auto pr-0.5 text-xs">
      {slice.map((row, i) => (
        <li
          key={i}
          className="rounded-md border border-border/50 bg-background/90 px-2 py-1.5 shadow-sm"
        >
          <div className="font-medium leading-snug text-foreground">
            {String(row[labelKey] ?? `#${i + 1}`)}
          </div>
          {detailKeys.length > 0 && (
            <dl className="mt-1 space-y-0.5 border-t border-border/40 pt-1 text-[10px] text-muted-foreground">
              {detailKeys.map((h) => (
                <div key={h} className="flex gap-2">
                  <dt className="shrink-0 font-normal text-muted-foreground/90">{resolveFieldLabel(h, fieldLabels)}</dt>
                  <dd className="min-w-0 flex-1 truncate text-right text-foreground/90">
                    {row[h] === null || row[h] === undefined ? "—" : String(row[h])}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </li>
      ))}
      {rows.length > maxRows && (
        <li className="py-1 text-center text-[10px] text-muted-foreground">
          仅显示前 {maxRows} 条，共 {rows.length} 条
        </li>
      )}
    </ul>
  )
}

function detectChartType(data: unknown[]): ChartType {
  if (!data || data.length === 0) return "json"

  const firstRow = data[0]
  if (!firstRow || typeof firstRow !== "object") return "json"

  const keys = Object.keys(firstRow)
  const numericKeys = keys.filter((k) => isNumericLike((firstRow as Record<string, unknown>)[k]))

  // If we have a few categories and one or two numeric values, suggest pie or bar
  if (numericKeys.length >= 1 && numericKeys.length <= 3) {
    // Check if data looks like categorical comparison
    const hasCategoryKey = keys.some(
      (k) =>
        typeof (firstRow as Record<string, unknown>)[k] === "string" &&
        (firstRow as Record<string, unknown>)[k]?.toString().length < 50
    )
    if (hasCategoryKey && numericKeys.length === 1) {
      return "bar" // Bar is more versatile for single metric
    }
  }

  // If we have time-series-like data (date/number keys), suggest line
  const dateKeys = keys.filter(
    (k) =>
      k.toLowerCase().includes("date") ||
      k.toLowerCase().includes("time") ||
      k.toLowerCase().includes("day") ||
      k.toLowerCase().includes("month")
  )
  if (dateKeys.length > 0 && numericKeys.length >= 1) {
    return "line"
  }

  // Default to bar chart for comparison data
  if (numericKeys.length >= 1) {
    return "bar"
  }

  return "table"
}

const COLORS = [
  "#3b82f6", // blue
  "#10b981", // emerald
  "#f59e0b", // amber
  "#ef4444", // red
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#06b6d4", // cyan
  "#84cc16", // lime
]

function DataPieChart({
  data,
  headers,
  rows,
  fieldBinding,
  fieldLabels,
}: {
  data: unknown[]
  headers: string[]
  rows: Record<string, unknown>[]
  fieldBinding?: { labelField?: string; valueFields?: string[] }
  fieldLabels?: Record<string, string>
}) {
  const inferred = inferNumericKeys(headers, rows)
  const numericSet = new Set(inferred)
  const labelKey =
    fieldBinding?.labelField && headers.includes(fieldBinding.labelField)
      ? fieldBinding.labelField
      : inferLabelKey(headers, rows, numericSet)
  const valueKey =
    fieldBinding?.valueFields?.[0] && inferred.includes(fieldBinding.valueFields[0])
      ? fieldBinding.valueFields[0]
      : inferred[0]

  if (!valueKey) return null

  const chartData = rows.map((row) => ({
    name: String(row[labelKey] ?? ""),
    value: toNumeric(row[valueKey]),
  }))

  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie
          data={chartData}
          cx="50%"
          cy="50%"
          labelLine={false}
          label={({ name, percent }) =>
            `${name}（${(percent * 100).toFixed(0)}%）`
          }
          outerRadius="80%"
          dataKey="value"
        >
          {chartData.map((_, index) => (
            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
          ))}
        </Pie>
        <Tooltip
          formatter={(value: unknown) => [
            formatTooltipNumber(value),
            resolveFieldLabel(valueKey, fieldLabels),
          ]}
          labelFormatter={(label) => (label != null && label !== "" ? `类别：${label}` : "")}
        />
        <Legend formatter={(value) => String(value)} />
      </PieChart>
    </ResponsiveContainer>
  )
}

function DataBarChart({
  data,
  headers,
  rows,
  fieldBinding,
  fieldLabels,
}: {
  data: unknown[]
  headers: string[]
  rows: Record<string, unknown>[]
  fieldBinding?: { labelField?: string; valueFields?: string[] }
  fieldLabels?: Record<string, string>
}) {
  const inferred = inferNumericKeys(headers, rows)
  let numericKeys: string[] = []
  if (fieldBinding?.valueFields?.length) {
    numericKeys = fieldBinding.valueFields.filter((k) => headers.includes(k) && inferred.includes(k))
  }
  if (numericKeys.length === 0) numericKeys = inferred

  const numericSet = new Set(numericKeys)
  const labelKey =
    fieldBinding?.labelField && headers.includes(fieldBinding.labelField)
      ? fieldBinding.labelField
      : inferLabelKey(headers, rows, numericSet)

  const chartRows = rows.map((row) => {
    const o: Record<string, unknown> = { ...row }
    for (const k of numericKeys) {
      o[k] = toNumeric(row[k])
    }
    return o
  })

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={chartRows}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey={labelKey} tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 12 }} />
        <Tooltip {...chartTooltipShared} />
        <Legend {...chartLegendShared} />
        {numericKeys.map((key, index) => (
          <Bar
            key={key}
            dataKey={key}
            name={resolveFieldLabel(key, fieldLabels)}
            fill={COLORS[index % COLORS.length]}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}

function DataLineChart({
  data,
  headers,
  rows,
  fieldBinding,
  fieldLabels,
}: {
  data: unknown[]
  headers: string[]
  rows: Record<string, unknown>[]
  fieldBinding?: { labelField?: string; valueFields?: string[] }
  fieldLabels?: Record<string, string>
}) {
  const inferred = inferNumericKeys(headers, rows)
  let numericKeys: string[] = []
  if (fieldBinding?.valueFields?.length) {
    numericKeys = fieldBinding.valueFields.filter((k) => headers.includes(k) && inferred.includes(k))
  }
  if (numericKeys.length === 0) numericKeys = inferred

  const numericSet = new Set(numericKeys)
  const dateLike = headers.find(
    (h) =>
      h.toLowerCase().includes("date") ||
      h.toLowerCase().includes("time") ||
      h.toLowerCase().includes("day") ||
      h.toLowerCase().includes("month")
  )
  const labelKey =
    fieldBinding?.labelField && headers.includes(fieldBinding.labelField)
      ? fieldBinding.labelField
      : dateLike && !numericSet.has(dateLike)
        ? dateLike
        : inferLabelKey(headers, rows, numericSet)

  const chartRows = rows.map((row) => {
    const o: Record<string, unknown> = { ...row }
    for (const k of numericKeys) {
      o[k] = toNumeric(row[k])
    }
    return o
  })

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={chartRows}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey={labelKey} tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 12 }} />
        <Tooltip {...chartTooltipShared} />
        <Legend {...chartLegendShared} />
        {numericKeys.map((key, index) => (
          <Line
            key={key}
            type="monotone"
            dataKey={key}
            name={resolveFieldLabel(key, fieldLabels)}
            stroke={COLORS[index % COLORS.length]}
            strokeWidth={2}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}

function DataTable({
  headers,
  rows,
  fieldLabels,
}: {
  headers: string[]
  rows: Record<string, unknown>[]
  fieldLabels?: Record<string, string>
}) {
  return (
    <div className="overflow-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b bg-muted/50">
            {headers.map((header) => (
              <th key={header} className="px-2 py-1 text-left font-medium">
                {resolveFieldLabel(header, fieldLabels)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 20).map((row, i) => (
            <tr key={i} className="border-b hover:bg-muted/30">
              {headers.map((header) => (
                <td key={header} className="px-2 py-1">
                  {String(row[header] ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 20 && (
        <div className="py-2 text-xs text-muted-foreground text-center">
          显示前 20 条，共 {rows.length} 条
        </div>
      )}
    </div>
  )
}

function JsonView({ data }: { data: unknown }) {
  return (
    <pre className="text-xs overflow-auto p-2 bg-muted/30 rounded">
      {JSON.stringify(data, null, 2)}
    </pre>
  )
}

export function DataVisualizer({ queryInterface, className, title, embedded }: DataVisualizerProps) {
  const [data, setData] = useState<unknown>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [autoChartType, setAutoChartType] = useState<ChartType>("unknown")

  const savedChartType = coerceSavedChartType(queryInterface.chartType as string | undefined)
  const displayChartType: ChartDisplayType | "json" =
    savedChartType ??
    (autoChartType === "unknown" ? "bar" : autoChartType === "json" ? "json" : autoChartType)
  const isChartTypeFixed = savedChartType !== undefined

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const url = buildFetchUrlFromInterface(queryInterface.path, queryInterface.baseUrl)

      const response = await fetch(url, {
        method: queryInterface.method || "GET",
        headers: buildFetchHeadersInit(queryInterface),
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const result = await response.json()
      setData(result)

      const effectiveFormat =
        queryInterface.responseFormat ?? detectResponseFormat(result)
      const parsed = parseResponseData(result, effectiveFormat)
      if (parsed.rows.length > 0) {
        setAutoChartType(detectChartType(parsed.rows))
      } else {
        setAutoChartType("json")
      }
    } catch (e) {
      setError(formatDataLoadError(e))
    } finally {
      setLoading(false)
    }
  }, [queryInterface])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const effectiveResponseFormat =
    queryInterface.responseFormat ??
    (data && typeof data === "object" ? detectResponseFormat(data) : undefined)

  const parsed = parseResponseData(data, effectiveResponseFormat)

  return (
    <div className={cn("flex flex-col h-full", className)}>
      <div
        className={cn(
          "flex shrink-0 items-center justify-start gap-2 px-2 py-1",
          embedded && "border-b border-border/50 bg-muted/35",
          !embedded && "py-0.5"
        )}
      >
        <div className="flex min-w-0  items-center gap-2">
          {title ? (
            <span className="truncate text-xs font-medium text-foreground">{title}</span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {!isChartTypeFixed && parsed.rows.length > 0 && (
            <div className="flex max-w-[min(100%,14rem)] flex-wrap justify-end gap-1">
              {(["bar", "pie", "line", "table"] as const).map((type) => (
                <button
                  key={type}
                  onClick={() => setAutoChartType(type)}
                  className={cn(
                    "shrink-0 text-[10px] px-1.5 py-0.5 rounded",
                    autoChartType === type
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted hover:bg-muted/80"
                  )}
                >
                  {type === "bar" && "柱状图"}
                  {type === "pie" && "饼图"}
                  {type === "line" && "折线图"}
                  {type === "table" && "表格"}
                </button>
              ))}
            </div>
          )}
          <Button variant="ghost" size="icon-xs" onClick={fetchData} disabled={loading} className="size-5">
            {loading ? <IconLoader className="size-3 animate-spin" /> : <IconRefresh className="size-3" />}
          </Button>
        </div>
      </div>

      <div className="flex-1 p-1 overflow-hidden">
        {loading && (
          <div className="flex h-full items-center justify-center">
            <IconLoader className="size-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {error && (
          <div className="flex h-full items-center justify-center text-xs text-red-500">
            {error}
          </div>
        )}

        {!loading && !error && data && (
          <div className="h-full">
            {displayChartType === "pie" && (
              <DataPieChart
                data={parsed.rows}
                headers={parsed.headers}
                rows={parsed.rows}
                fieldBinding={queryInterface.fieldBinding}
                fieldLabels={queryInterface.fieldLabels}
              />
            )}
            {displayChartType === "bar" && (
              <DataBarChart
                data={parsed.rows}
                headers={parsed.headers}
                rows={parsed.rows}
                fieldBinding={queryInterface.fieldBinding}
                fieldLabels={queryInterface.fieldLabels}
              />
            )}
            {displayChartType === "line" && (
              <DataLineChart
                data={parsed.rows}
                headers={parsed.headers}
                rows={parsed.rows}
                fieldBinding={queryInterface.fieldBinding}
                fieldLabels={queryInterface.fieldLabels}
              />
            )}
            {displayChartType === "table" && (
              <DataTable headers={parsed.headers} rows={parsed.rows} fieldLabels={queryInterface.fieldLabels} />
            )}
            {displayChartType === "metric" && (
              <DataMetricView
                headers={parsed.headers}
                rows={parsed.rows}
                fieldBinding={queryInterface.fieldBinding}
                fieldLabels={queryInterface.fieldLabels}
              />
            )}
            {displayChartType === "list" && (
              <DataListView
                headers={parsed.headers}
                rows={parsed.rows}
                fieldBinding={queryInterface.fieldBinding}
                fieldLabels={queryInterface.fieldLabels}
              />
            )}
            {displayChartType === "json" && <JsonView data={data} />}
          </div>
        )}

        {!loading && !error && !data && (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            暂无数据
          </div>
        )}
      </div>
    </div>
  )
}
