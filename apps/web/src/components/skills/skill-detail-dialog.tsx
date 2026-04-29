import * as React from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { Badge } from "@workspace/ui/components/badge"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { Separator } from "@workspace/ui/components/separator"
import type { SkillListItem } from "@/api/types"

export function SkillDetailDialog({
  open,
  onOpenChange,
  skill,
  source,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  skill: SkillListItem | null
  source: "remote" | "local"
}) {
  if (!skill) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[80vh] flex-col gap-0 p-0 sm:max-w-lg">
        <DialogHeader className="px-6 pt-6 pb-4">
          <div className="flex items-center gap-2">
            <DialogTitle className="text-base">
              {skill.displayNameZh || skill.skillName}
            </DialogTitle>
            <Badge variant={source === "remote" ? "secondary" : "outline"} className="px-1.5 py-0 text-[10px]">
              {source === "remote" ? "远程" : "本地"}
            </Badge>
          </div>
        </DialogHeader>

        <ScrollArea className="min-h-0 flex-1 px-6 pb-6">
          <div className="space-y-4">
            {skill.description && (
              <div>
                <h4 className="mb-1 text-xs font-medium text-muted-foreground">
                  描述
                </h4>
                <p className="text-sm leading-relaxed">{skill.description}</p>
              </div>
            )}

            {skill.skillName && (
              <div>
                <h4 className="mb-1 text-xs font-medium text-muted-foreground">
                  技能名称
                </h4>
                <p className="font-mono text-sm">{skill.skillName}</p>
              </div>
            )}

            {skill.directoryName && (
              <div>
                <h4 className="mb-1 text-xs font-medium text-muted-foreground">
                  所属目录
                </h4>
                <p className="text-sm">{skill.directoryName}</p>
              </div>
            )}

            {skill.prompt && (
              <>
                <Separator />
                <div>
                  <h4 className="mb-1 text-xs font-medium text-muted-foreground">
                    Prompt
                  </h4>
                  <pre className="max-h-60 overflow-auto rounded-md bg-muted p-3 text-xs leading-relaxed whitespace-pre-wrap">
                    {skill.prompt}
                  </pre>
                </div>
              </>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
