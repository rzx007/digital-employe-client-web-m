import * as React from "react"
import { IconFileImport, IconLoader2 } from "@tabler/icons-react"
import { toast } from "sonner"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Switch } from "@workspace/ui/components/switch"
import { Textarea } from "@workspace/ui/components/textarea"
import { cn } from "@workspace/ui/lib/utils"
import { importLocalSkill, checkLocalSkillNameExists } from "@/api/skill"
import { downloadResourceBlob, fetchResourceContent } from "@/api/chat"

type LoadState = "loading" | "loaded" | "error"

function parseSimpleFrontmatter(content: string): {
  description: string
  body: string
} {
  const match = content.match(/^\s*---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/)
  if (!match) {
    return { description: "", body: content }
  }
  const frontmatterText = match[1]
  const body = content.slice(match[0].length)
  const descMatch = frontmatterText.match(/description\s*[:：]\s*(.+)/)
  const description = descMatch
    ? descMatch[1].trim().replace(/^["']|["']$/g, "")
    : ""
  return { description, body }
}

export function ImportDraftSkillDialog({
  open,
  onOpenChange,
  onSuccess,
  conversationId,
  skillPath,
  skillName: defaultSkillName,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
  conversationId: string | number
  skillPath: string
  skillName: string
}) {
  const [loadState, setLoadState] = React.useState<LoadState>("loading")
  const [skillName, setSkillName] = React.useState(defaultSkillName)
  const [description, setDescription] = React.useState("")
  const [promptContent, setPromptContent] = React.useState("")
  const [overwrite, setOverwrite] = React.useState(false)
  const [submitting, setSubmitting] = React.useState(false)
  const [nameError, setNameError] = React.useState("")

  React.useEffect(() => {
    if (!open) return

    setLoadState("loading")
    setSkillName(defaultSkillName)
    setDescription("")
    setPromptContent("")
    setOverwrite(false)
    setNameError("")
    setSubmitting(false)

    const load = async () => {
      try {
        const res = await fetchResourceContent(
          conversationId,
          `${skillPath}/SKILL.md`
        )
        if (res?.data?.content) {
          const { description: desc, body } = parseSimpleFrontmatter(
            res.data.content
          )
          setDescription(desc || "")
          setPromptContent(body || "")
        }
        setLoadState("loaded")
      } catch {
        setLoadState("loaded")
      }
    }

    load()
  }, [open, conversationId, skillPath, defaultSkillName])

  const handleNameBlur = async () => {
    if (!skillName.trim()) {
      setNameError("")
      return
    }
    try {
      const exists = await checkLocalSkillNameExists(skillName.trim())
      if (exists && !overwrite) {
        setNameError("技能名称已存在，可开启覆盖导入")
      } else {
        setNameError("")
      }
    } catch {
      // ignore
    }
  }

  const handleSubmit = async () => {
    const trimmed = skillName.trim()
    if (!trimmed) {
      toast.error("请输入技能名称")
      return
    }
    if (nameError) {
      toast.error(nameError)
      return
    }

    setSubmitting(true)
    try {
      const blob = await downloadResourceBlob(conversationId, skillPath)
      const file = new File([blob], `${trimmed}.zip`, {
        type: "application/zip",
      })
      const result = await importLocalSkill({
        skillName: trimmed,
        file,
        overwrite,
      })
      toast.success(
        result.overwritten
          ? `技能「${result.skillName}」已覆盖导入`
          : `技能「${result.skillName}」导入成功`
      )
      onSuccess()
      onOpenChange(false)
    } catch (err) {
      const msg = err instanceof Error ? err.message : "导入失败，请稍后重试"
      toast.error(msg)
    } finally {
      setSubmitting(false)
    }
  }

  const canSubmit =
    loadState === "loaded" && !!skillName.trim() && !nameError && !submitting

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(90vh,calc(100dvh-2rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="shrink-0 space-y-1 border-b px-4 pt-4 pr-12 pb-3">
          <DialogTitle>导入到技能库</DialogTitle>
          <DialogDescription>将技能草稿导入到本地技能库中</DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 py-3">
          {loadState === "loading" ? (
            <div className="flex items-center justify-center py-12">
              <IconLoader2 className="size-5 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">
                加载中...
              </span>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col gap-3">
              <div className="flex shrink-0 items-center gap-3 rounded-lg border bg-muted/20 px-3 py-2.5">
                <IconFileImport className="size-5 shrink-0 text-blue-500" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {defaultSkillName}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    来源：{skillPath}
                  </p>
                </div>
              </div>

              <div className="flex shrink-0 flex-col gap-1.5">
                <Label htmlFor="draft-skill-name">
                  <span className="text-destructive">*</span>
                  技能名称
                </Label>
                <Input
                  id="draft-skill-name"
                  placeholder="例如: my-skill"
                  value={skillName}
                  onChange={(e) => {
                    setSkillName(e.target.value)
                    setNameError("")
                  }}
                  onBlur={handleNameBlur}
                  aria-invalid={!!nameError}
                />
                {nameError && (
                  <p className="text-xs text-destructive">{nameError}</p>
                )}
              </div>

              <div className="flex shrink-0 flex-col gap-1.5">
                <Label htmlFor="draft-skill-description">描述</Label>
                <Textarea
                  id="draft-skill-description"
                  value={description}
                  readOnly
                  rows={4}
                  placeholder="未检测到描述信息"
                  className={cn(
                    "field-sizing-fixed max-h-36 min-h-20 cursor-default overflow-y-auto",
                    "bg-muted/30"
                  )}
                />
              </div>

              <div className="flex min-h-0 flex-1 flex-col gap-1.5">
                <Label htmlFor="draft-skill-prompt" className="shrink-0">
                  指令
                </Label>
                <Textarea
                  id="draft-skill-prompt"
                  value={promptContent}
                  readOnly
                  rows={8}
                  placeholder="SKILL.md 正文为空"
                  className={cn(
                    "field-sizing-fixed min-h-32 flex-1 cursor-default",
                    "overflow-y-auto bg-muted/30 font-mono text-xs"
                  )}
                />
              </div>

              <div className="flex shrink-0 items-center justify-between rounded-md border bg-muted/20 px-3 py-2">
                <div className="flex flex-col gap-0.5">
                  <Label
                    htmlFor="draft-overwrite-switch"
                    className="cursor-pointer text-xs"
                  >
                    覆盖已有
                  </Label>
                  <span className="text-[11px] text-muted-foreground">
                    同名技能将被覆盖
                  </span>
                </div>
                <Switch
                  id="draft-overwrite-switch"
                  checked={overwrite}
                  onCheckedChange={(value) => {
                    setOverwrite(value)
                    if (value && nameError) {
                      setNameError("")
                    }
                  }}
                />
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0 gap-3 border-t px-4 py-3 sm:flex-row sm:items-center sm:justify-end">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            取消
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {submitting ? (
              <span className="flex items-center gap-1.5">
                <IconLoader2 className="size-3.5 animate-spin" />
                导入中...
              </span>
            ) : (
              "确认导入"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
