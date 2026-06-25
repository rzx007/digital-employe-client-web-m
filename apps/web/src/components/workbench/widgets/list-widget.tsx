import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Badge } from "@workspace/ui/components/badge"
import type { WorkbenchWidget } from "@/types/workbench"

interface ListItem {
  title: string
  value?: string | number | null
  badge?: string | null
  icon?: string | null
}

interface ListData {
  items?: ListItem[]
}

export function ListWidget({
  widget,
  data,
}: {
  widget: WorkbenchWidget
  data: ListData
}) {
  const items: ListItem[] = data?.items ?? []

  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{widget.title}</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <div className="flex h-16 items-center justify-center text-xs text-muted-foreground">
            暂无数据
          </div>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {items.map((it, i) => (
              <li
                key={i}
                className="flex items-center justify-between gap-2 py-2"
              >
                <span className="text-xs">{it.title}</span>
                <div className="flex shrink-0 items-center gap-1.5">
                  {it.value !== null && it.value !== undefined && (
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {String(it.value)}
                    </span>
                  )}
                  {it.badge != null && (
                    <Badge variant="secondary">{it.badge}</Badge>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
