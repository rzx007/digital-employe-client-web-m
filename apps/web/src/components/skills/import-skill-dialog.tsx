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
import { cn } from "@workspace/ui/lib/utils"
import { importLocalSkill, checkLocalSkillNameExists } from "@/api/skill"

export function ImportSkillDialog({
  open,
  onOpenChange,
  onSuccess,
  trigger,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
  trigger?: boolean
}) {
  const [skillName, setSkillName] = React.useState("")
  const [directoryId, setDirectoryId] = React.useState("0")
  const [file, setFile] = React.useState<File | null>(null)
  const [overwrite, setOverwrite] = React.useState(false)
  const [submitting, setSubmitting] = React.useState(false)
  const [nameError, setNameError] = React.useState("")
  const [isDragActive, setIsDragActive] = React.useState(false)
  const [isNameTouched, setIsNameTouched] = React.useState(false)
  const fileInputRef = React.useRef<HTMLInputElement | null>(null)

  React.useEffect(() => {
    if (open) {
      setSkillName("")
      setDirectoryId("0")
      setFile(null)
      setOverwrite(false)
      setNameError("")
      setSubmitting(false)
      setIsDragActive(false)
      setIsNameTouched(false)
    }
  }, [open])

  const deriveSkillNameFromFile = React.useCallback((fileName: string) => {
    return fileName.replace(/\.zip$/i, "").trim()
  }, [])

  const handleFileSelect = React.useCallback(
    (nextFile: File | null) => {
      if (!nextFile) return
      const isZip =
        nextFile.name.toLowerCase().endsWith(".zip") ||
        nextFile.type.includes("zip")
      if (!isZip) {
        toast.error("仅支持上传 ZIP 文件")
        return
      }
      setFile(nextFile)
      if (!isNameTouched && !skillName.trim()) {
        setSkillName(deriveSkillNameFromFile(nextFile.name))
      }
    },
    [deriveSkillNameFromFile, isNameTouched, skillName]
  )

  const handleDragOver: React.DragEventHandler<HTMLDivElement> = (e) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragActive(true)
  }

  const handleDragLeave: React.DragEventHandler<HTMLDivElement> = (e) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragActive(false)
  }

  const handleDrop: React.DragEventHandler<HTMLDivElement> = (e) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragActive(false)
    const dropped = e.dataTransfer.files?.[0] ?? null
    handleFileSelect(dropped)
  }

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
        directoryId: directoryId ? Number(directoryId) : 0,
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
    <>
      {trigger && (
        <Button
          variant="outline"
          size="icon"
          className="size-8"
          onClick={() => onOpenChange(true)}
          aria-label="导入本地技能"
          title="导入本地技能"
        >
          <IconUpload className="size-4" />
        </Button>
      )}
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
                  setIsNameTouched(true)
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
              <Label>ZIP 文件</Label>
              <Input
                ref={fileInputRef}
                type="file"
                accept=".zip,application/zip,application/x-zip-compressed"
                onChange={(e) => handleFileSelect(e.target.files?.[0] ?? null)}
                className="hidden"
              />
              <div
                role="button"
                tabIndex={0}
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    fileInputRef.current?.click()
                  }
                }}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={cn(
                  "cursor-pointer rounded-lg border border-dashed bg-muted/20 p-4 text-center transition-colors",
                  isDragActive && "border-primary bg-primary/5"
                )}
              >
                <div className="mx-auto mb-2 flex size-8 items-center justify-center rounded-md bg-muted text-muted-foreground">
                  <IconUpload className="size-4" />
                </div>
                <p className="text-sm font-medium">
                  拖拽 ZIP 到此处或点击上传
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  仅支持 .zip 文件
                </p>
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
    </>
  )
}
