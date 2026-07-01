import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { SHORTCUTS } from "./constants"

export function ShortcutsSettings() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          快捷键{" "}
          <em className="ml-2 text-xs text-muted-foreground">开发中...</em>
        </CardTitle>
        <CardDescription>应用支持的键盘快捷键</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3">
          {SHORTCUTS.map((item) => (
            <div
              key={item.key}
              className="flex items-center justify-between rounded-md border p-3"
            >
              <span className="text-sm">{item.action}</span>
              <kbd className="rounded bg-muted px-2 py-1 font-mono text-xs">
                {item.key}
              </kbd>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
