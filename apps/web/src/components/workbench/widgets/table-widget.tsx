import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"
import type { WorkbenchWidget } from "@/types/workbench"

type Align = "left" | "center" | "right"

// 列既可能是字符串(LLM 常用),也可能是 {key,label} 对象
type RawColumn = string | { key?: string; label?: string; align?: Align }
// 行既可能是定位数组(LLM 常用),也可能是按 key 索引的对象
type RawRow = Record<string, unknown> | unknown[]

interface TableData {
  columns?: RawColumn[]
  rows?: RawRow[]
}

interface NormColumn {
  key: string
  label: string
  align?: Align
}

function normalizeColumns(raw: RawColumn[]): NormColumn[] {
  return raw.map((c, i) =>
    typeof c === "string"
      ? { key: String(i), label: c }
      : { key: c.key ?? String(i), label: c.label ?? c.key ?? "", align: c.align }
  )
}

// 兼容四种 columns×rows 组合:字符串列/对象列 × 数组行/对象行
function cellOf(row: RawRow, col: NormColumn, colIndex: number): unknown {
  if (Array.isArray(row)) return row[colIndex]
  if (row && typeof row === "object") {
    const obj = row as Record<string, unknown>
    if (col.key in obj) return obj[col.key]
    // 列是字符串、行却是对象时,key 是索引取不到 → 回退按位置取对象第 colIndex 个值
    return Object.values(obj)[colIndex]
  }
  return undefined
}

export function TableWidget({
  widget,
  data,
}: {
  widget: WorkbenchWidget
  data: TableData
}) {
  const columns = normalizeColumns(data?.columns ?? [])
  const rows: RawRow[] = data?.rows ?? []

  const alignClass = (align?: Align) => {
    if (align === "center") return "text-center"
    if (align === "right") return "text-right"
    return "text-left"
  }

  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{widget.title}</CardTitle>
        {widget.subtitle ? (
          <CardDescription className="text-xs">{widget.subtitle}</CardDescription>
        ) : null}
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <div className="flex h-16 items-center justify-center text-xs text-muted-foreground">
            暂无数据
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                {columns.map((col) => (
                  <TableHead key={col.key} className={alignClass(col.align)}>
                    {col.label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, i) => (
                <TableRow key={i}>
                  {columns.map((col, ci) => {
                    const val = cellOf(row, col, ci)
                    return (
                      <TableCell key={col.key} className={alignClass(col.align)}>
                        {val === null || val === undefined ? "—" : String(val)}
                      </TableCell>
                    )
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
