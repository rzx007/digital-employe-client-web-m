import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"
import { cn } from "@workspace/ui/lib/utils"
import type { WorkbenchWidget } from "@/types/workbench"
import { WidgetCard, WidgetEmpty } from "./widget-card"

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
    if (align === "right") return "text-right tabular-nums"
    return "text-left"
  }

  return (
    <WidgetCard
      title={widget.title}
      subtitle={widget.subtitle}
      bodyClassName="overflow-auto px-0 pb-1"
    >
      {rows.length === 0 ? (
        <WidgetEmpty />
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="border-border/60 hover:bg-transparent">
              {columns.map((col) => (
                <TableHead
                  key={col.key}
                  className={cn(
                    "h-8 px-4 text-xs font-medium text-muted-foreground",
                    alignClass(col.align)
                  )}
                >
                  {col.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, i) => (
              <TableRow
                key={i}
                className="border-border/40 transition-colors last:border-0 hover:bg-muted/50"
              >
                {columns.map((col, ci) => {
                  const val = cellOf(row, col, ci)
                  return (
                    <TableCell
                      key={col.key}
                      className={cn(
                        "px-4 py-2 text-sm text-foreground/90",
                        alignClass(col.align)
                      )}
                    >
                      {val === null || val === undefined ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        String(val)
                      )}
                    </TableCell>
                  )
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </WidgetCard>
  )
}
