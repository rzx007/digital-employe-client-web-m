import * as React from "react"
import { IconUpload } from "@tabler/icons-react"
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
import { importLocalSkill, checkLocalSkillNameExists } from "@/api/skill"

export function ImportSkillDialog({
  open,
  onOpenChange,
  onSuccess,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}) {
  const [skillName, setSkillName] = React.useState("")
  const [directoryId, setDirectoryId] = React.useState("")
  const [file, setFile] = React.useState<File | null>(null)
  const [overwrite, setOverwrite] = React.useState(false)
  const [submitting, setSubmitting] = React.useState(false)
  const [nameError, setNameError] = React.useState("")

  React.useEffect(() => {
    if (open) {
      setSkillName("")
      setDirectoryId("")
      setFile(null)
      setOverwrite(false)
      setNameError("")
      setSubmitting(false)
    }
  }, [open])

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
    if (!file) {
      toast.error("请选择 ZIP 文件")
      return
    }
    if (nameError) {
      toast.error(nameError)
      return
    }

    setSubmitting(true)
    try {
      const result = await importLocalSkill({
        skillName: trimmed,
        directoryId: directoryId ? Number(directoryId) : undefined,
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
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "导入失败，请稍后重试"
      toast.error(msg)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>导入本地技能</DialogTitle>
          <DialogDescription>
            上传技能 ZIP 包到本地技能库
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="skill-name">技能名称</Label>
            <Input
              id="skill-name"
              placeholder="例如: my-skill（仅英文、数字、下划线、连字符）"
              value={skillName}
              onChange={(e) => {
                setSkillName(e.target.value)
                setNameError("")
              }}
              onBlur={handleNameBlur}
            />
            {nameError && (
              <p className="text-xs text-destructive">{nameError}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="directory-id">目录 ID（可选）</Label>
            <Input
              id="directory-id"
              type="number"
              placeholder="远程目录 ID"
              value={directoryId}
              onChange={(e) => setDirectoryId(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>ZIP 文件</Label>
            <div className="flex items-center gap-2">
              <Input
                type="file"
                accept=".zip"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="cursor-pointer"
              />
            </div>
            {file && (
              <p className="text-xs text-muted-foreground">
                {file.name} ({(file.size / 1024 / 1024).toFixed(1)} MB)
              </p>
            )}
          </div>

          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-0.5">
              <Label htmlFor="overwrite-switch" className="cursor-pointer text-sm">
                覆盖已有
              </Label>
              <span className="text-xs text-muted-foreground">
                同名技能将被覆盖
              </span>
            </div>
            <Switch
              id="overwrite-switch"
              checked={overwrite}
              onCheckedChange={setOverwrite}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={submitting || !skillName.trim() || !file}
          >
            {submitting ? (
              "导入中..."
            ) : (
              <span className="flex items-center gap-1.5">
                <IconUpload className="size-3.5" />
                导入
              </span>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
