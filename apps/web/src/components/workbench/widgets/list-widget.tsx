import { Badge } from "@workspace/ui/components/badge"
import type { WorkbenchWidget } from "@/types/workbench"
import { WidgetCard, WidgetEmpty } from "./widget-card"

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
    <WidgetCard
      title={widget.title}
      subtitle={widget.subtitle}
      bodyClassName="px-0 pb-2"
    >
      {items.length === 0 ? (
        <WidgetEmpty />
      ) : (
        <ul className="flex flex-col">
          {items.map((it, i) => (
            <li
              key={i}
              className="flex items-center justify-between gap-3 px-4 py-2 transition-colors hover:bg-muted/50"
            >
              <span className="min-w-0 truncate text-sm text-foreground/90">
                {it.title}
              </span>
              <div className="flex shrink-0 items-center gap-2">
                {it.value !== null && it.value !== undefined ? (
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {String(it.value)}
                  </span>
                ) : null}
                {it.badge != null ? (
                  <Badge variant="secondary" className="font-normal">
                    {it.badge}
                  </Badge>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </WidgetCard>
  )
}
