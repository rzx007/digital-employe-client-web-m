import {
  Card,
  CardContent,
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

interface ColumnDef {
  key: string
  label: string
  align?: "left" | "center" | "right"
}

interface TableData {
  columns?: ColumnDef[]
  rows?: Record<string, any>[]
}

export function TableWidget({
  widget,
  data,
}: {
  widget: WorkbenchWidget
  data: TableData
}) {
  const columns: ColumnDef[] = data?.columns ?? []
  const rows: Record<string, any>[] = data?.rows ?? []

  const alignClass = (align?: string) => {
    if (align === "center") return "text-center"
    if (align === "right") return "text-right"
    return "text-left"
  }

  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{widget.title}</CardTitle>
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
                  {columns.map((col) => {
                    const val = row[col.key]
                    return (
                      <TableCell
                        key={col.key}
                        className={alignClass(col.align)}
                      >
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
