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
import { Skeleton } from "@workspace/ui/components/skeleton"
import { fetchLocalSkillDetail } from "@/api/skill"
import type { LocalSkillDetail, LocalSkillItem } from "@/api/types"

export function LocalSkillDetailDialog({
  open,
  onOpenChange,
  skill,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  skill: LocalSkillItem | null
}) {
  const [detail, setDetail] = React.useState<LocalSkillDetail | null>(null)
  const [loading, setLoading] = React.useState(false)

  React.useEffect(() => {
    if (open && skill) {
      setLoading(true)
      setDetail(null)
      fetchLocalSkillDetail(skill.skillName)
        .then(setDetail)
        .catch(() => setDetail(null))
        .finally(() => setLoading(false))
    }
    if (!open) {
      setDetail(null)
    }
  }, [open, skill])

  if (!skill) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[80vh] flex-col gap-0 p-0 sm:max-w-lg">
        <DialogHeader className="px-6 pt-6 pb-4">
          <div className="flex items-center gap-2">
            <DialogTitle className="text-base">{skill.skillName}</DialogTitle>
            <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
              本地
            </Badge>
          </div>
        </DialogHeader>

        <ScrollArea className="min-h-0 flex-1 px-6 pb-6">
          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : detail ? (
            <div className="space-y-4">
              {detail.importedAt && (
                <div>
                  <h4 className="mb-1 text-xs font-medium text-muted-foreground">
                    导入时间
                  </h4>
                  <p className="text-sm">
                    {new Date(detail.importedAt).toLocaleString("zh-CN")}
                  </p>
                </div>
              )}

              {detail.files.length > 0 && (
                <div>
                  <h4 className="mb-1 text-xs font-medium text-muted-foreground">
                    文件列表
                  </h4>
                  <div className="rounded-md bg-muted p-3">
                    {detail.files.map((f) => (
                      <p
                        key={f}
                        className="font-mono text-xs leading-relaxed text-muted-foreground"
                      >
                        {f}
                      </p>
                    ))}
                  </div>
                </div>
              )}

              {detail.skillMdContent && (
                <>
                  <Separator />
                  <div>
                    <h4 className="mb-1 text-xs font-medium text-muted-foreground">
                      SKILL.md
                    </h4>
                    <pre className="max-h-80 overflow-auto rounded-md bg-muted p-3 text-xs leading-relaxed whitespace-pre-wrap">
                      {detail.skillMdContent}
                    </pre>
                  </div>
                </>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              无法加载技能详情
            </p>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
