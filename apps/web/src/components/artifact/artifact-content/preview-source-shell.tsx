import * as React from "react"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs"
import { cn } from "@workspace/ui/lib/utils"
import type { Artifact } from "../artifact-types"

export type PreviewSourceMode = "preview" | "source"

export interface PreviewSourceShellProps {
  artifact: Artifact
  className?: string
  renderPreview: () => React.ReactNode
  renderSource: () => React.ReactNode
  defaultMode?: PreviewSourceMode
  headerActions?: React.ReactNode
}

export function PreviewSourceShell({
  artifact,
  className,
  renderPreview,
  renderSource,
  defaultMode = "preview",
  headerActions,
}: PreviewSourceShellProps) {
  const [mode, setMode] = React.useState<PreviewSourceMode>(defaultMode)
  const resetKey = `${artifact.id}:${String(artifact.metadata?.resourcePath ?? "")}`

  React.useEffect(() => {
    setMode(defaultMode)
  }, [resetKey, defaultMode])

  return (
    <Tabs
      value={mode}
      onValueChange={(value) => setMode(value as PreviewSourceMode)}
      className={cn("flex min-h-0 min-w-0 flex-1 flex-col gap-0", className)}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b bg-muted/30 px-3 py-1.5">
        <TabsList className="h-8 bg-transparent p-0">
          <TabsTrigger value="preview" className="h-7 px-3 text-xs">
            预览
          </TabsTrigger>
          <TabsTrigger value="source" className="h-7 px-3 text-xs">
            源码
          </TabsTrigger>
        </TabsList>
        {headerActions ? (
          <div className="flex shrink-0 items-center gap-1">{headerActions}</div>
        ) : null}
      </div>
      <TabsContent
        value="preview"
        className="mt-0 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden data-[state=inactive]:hidden"
      >
        {renderPreview()}
      </TabsContent>
      <TabsContent
        value="source"
        className="mt-0 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden data-[state=inactive]:hidden"
      >
        {renderSource()}
      </TabsContent>
    </Tabs>
  )
}
