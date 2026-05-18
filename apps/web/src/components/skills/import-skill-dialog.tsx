import * as React from "react"
import {
  IconAlertTriangleFilled,
  IconCircleCheckFilled,
  IconFileTypeZip,
  IconLoader2,
  IconRefresh,
  IconUpload,
} from "@tabler/icons-react"
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
import { parseSkillZip } from "@/lib/skill-zip"

type ParseState = "idle" | "parsing" | "parsed"

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
  const [parseState, setParseState] = React.useState<ParseState>("idle")
  const [skillName, setSkillName] = React.useState("")
  const [displayNameZh, setDisplayNameZh] = React.useState("")
  const [description, setDescription] = React.useState("")
  const [promptContent, setPromptContent] = React.useState("")
  const [file, setFile] = React.useState<File | null>(null)
  const [overwrite, setOverwrite] = React.useState(false)
  const [submitting, setSubmitting] = React.useState(false)
  const [nameError, setNameError] = React.useState("")
  const [isDragActive, setIsDragActive] = React.useState(false)
  const fileInputRef = React.useRef<HTMLInputElement | null>(null)

  const resetState = React.useCallback(() => {
    setParseState("idle")
    setSkillName("")
    setDisplayNameZh("")
    setDescription("")
    setPromptContent("")
    setFile(null)
    setOverwrite(false)
    setNameError("")
    setSubmitting(false)
    setIsDragActive(false)
    if (fileInputRef.current) {
      fileInputRef.current.value = ""
    }
  }, [])

  React.useEffect(() => {
    if (open) {
      resetState()
    }
  }, [open, resetState])

  const handleFileSelect = React.useCallback(
    async (nextFile: File | null) => {
      if (!nextFile) return
      const isZip =
        nextFile.name.toLowerCase().endsWith(".zip") ||
        nextFile.type.includes("zip")
      if (!isZip) {
        toast.error("仅支持上传 ZIP 文件")
        return
      }
      setFile(nextFile)
      setParseState("parsing")
      try {
        const parsed = await parseSkillZip(nextFile)
        setSkillName(parsed.skillName)
        setDescription(parsed.description)
        setPromptContent(parsed.promptContent)
        setNameError("")
        setParseState("parsed")
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "解析 ZIP 失败"
        toast.error(msg)
        setFile(null)
        setSkillName("")
        setDisplayNameZh("")
        setDescription("")
        setPromptContent("")
        setParseState("idle")
        if (fileInputRef.current) {
          fileInputRef.current.value = ""
        }
      }
    },
    []
  )

  const handleDragOver: React.DragEventHandler<HTMLDivElement> = (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (parseState === "parsing") return
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
    if (parseState === "parsing") return
    const dropped = e.dataTransfer.files?.[0] ?? null
    void handleFileSelect(dropped)
  }

  const openFilePicker = React.useCallback(() => {
    if (parseState === "parsing") return
    fileInputRef.current?.click()
  }, [parseState])

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
        directoryId: 0,
        file,
        overwrite,
        displayNameZh: displayNameZh.trim() || undefined,
      })
      toast.success(
        result.overwritten
          ? `技能「${result.skillName}」已覆盖导入`
          : `技能「${result.skillName}」导入成功`
      )
      onSuccess()
      onOpenChange(false)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "导入失败，请稍后重试"
      toast.error(msg)
    } finally {
      setSubmitting(false)
    }
  }

  const fileSizeLabel = file ? `${(file.size / 1024 / 1024).toFixed(2)} MB` : ""
  const canSubmit =
    parseState === "parsed" &&
    !!file &&
    !!skillName.trim() &&
    !nameError &&
    !submitting

  return (
    <>
      {trigger && (
        <Button
          size="icon"
          className="size-8"
          onClick={() => onOpenChange(true)}
          aria-label="创建技能"
          title="创建技能"
        >
          <IconUpload className="size-4" />
        </Button>
      )}
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[min(90vh,calc(100dvh-2rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
          <DialogHeader className="shrink-0 space-y-1 border-b px-4 pt-4 pb-3 pr-12">
            <DialogTitle>创建技能</DialogTitle>
            <DialogDescription>
              上传 ZIP 包，解析后预览并导入到本地技能库
            </DialogDescription>
          </DialogHeader>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 py-3">
            <div
              className={cn(
                "flex flex-col gap-3",
                parseState === "parsed" && "min-h-0 flex-1",
              )}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".zip,application/zip,application/x-zip-compressed"
                onChange={(e) =>
                  void handleFileSelect(e.target.files?.[0] ?? null)
                }
                className="hidden"
              />

              <UploadCard
                parseState={parseState}
                file={file}
                isDragActive={isDragActive}
                fileSizeLabel={fileSizeLabel}
                onPickFile={openFilePicker}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              />

              {parseState === "parsed" && (
                <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
                  <div className="shrink-0 flex flex-col gap-1.5">
                    <Label htmlFor="skill-name" className="gap-0.5">
                      <span className="text-destructive">*</span>
                      技能名称
                    </Label>
                    <Input
                      id="skill-name"
                      placeholder="例如: my-skill（仅英文、数字、下划线、连字符）"
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

                  <div className="shrink-0 flex flex-col gap-1.5">
                    <Label htmlFor="skill-display-zh">中文名称</Label>
                    <Input
                      id="skill-display-zh"
                      placeholder="可选，用于界面展示"
                      value={displayNameZh}
                      onChange={(e) => setDisplayNameZh(e.target.value)}
                    />
                  </div>

                  <div className="shrink-0 flex flex-col gap-1.5">
                    <Label htmlFor="skill-description">描述</Label>
                    <Textarea
                      id="skill-description"
                      value={description}
                      readOnly
                      rows={4}
                      placeholder="未在 SKILL.md frontmatter 中检测到 description"
                      className={cn(
                        "field-sizing-fixed max-h-36 min-h-20 cursor-default overflow-y-auto",
                        "bg-muted/30",
                      )}
                    />
                  </div>

                  <div className="flex min-h-0 flex-1 flex-col gap-1.5">
                    <Label htmlFor="skill-prompt" className="shrink-0">
                      指令
                    </Label>
                    <Textarea
                      id="skill-prompt"
                      value={promptContent}
                      readOnly
                      rows={8}
                      placeholder="SKILL.md 正文为空"
                      className={cn(
                        "field-sizing-fixed min-h-32 flex-1 cursor-default",
                        "overflow-y-auto bg-muted/30 font-mono text-xs",
                      )}
                    />
                  </div>

                  <div className="shrink-0 flex items-center justify-between rounded-md border bg-muted/20 px-3 py-2">
                    <div className="flex flex-col gap-0.5">
                      <Label
                        htmlFor="overwrite-switch"
                        className="cursor-pointer text-xs"
                      >
                        覆盖已有
                      </Label>
                      <span className="text-[11px] text-muted-foreground">
                        同名技能将被覆盖
                      </span>
                    </div>
                    <Switch
                      id="overwrite-switch"
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
          </div>

          <DialogFooter className="shrink-0 gap-3 border-t px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-1.5 text-[11px] text-amber-600 dark:text-amber-400">
              <IconAlertTriangleFilled className="size-3.5 shrink-0" />
              <span>请在配置前确认来源并评估潜在风险。</span>
            </div>
            <div className="flex gap-2 sm:ml-auto">
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={submitting}
              >
                取消
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={!canSubmit}
                aria-label="确认导入"
              >
                {submitting ? (
                  <span className="flex items-center gap-1.5">
                    <IconLoader2 className="size-3.5 animate-spin" />
                    导入中...
                  </span>
                ) : (
                  "确认"
                )}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function UploadCard({
  parseState,
  file,
  isDragActive,
  fileSizeLabel,
  onPickFile,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  parseState: ParseState
  file: File | null
  isDragActive: boolean
  fileSizeLabel: string
  onPickFile: () => void
  onDragOver: React.DragEventHandler<HTMLDivElement>
  onDragLeave: React.DragEventHandler<HTMLDivElement>
  onDrop: React.DragEventHandler<HTMLDivElement>
}) {
  const interactive = parseState !== "parsing"

  return (
    <div
      role="button"
      tabIndex={interactive ? 0 : -1}
      aria-disabled={!interactive}
      onClick={interactive ? onPickFile : undefined}
      onKeyDown={(e) => {
        if (!interactive) return
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onPickFile()
        }
      }}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={cn(
        "group relative flex flex-col items-center justify-center rounded-lg border border-dashed bg-muted/20 px-4 py-6 text-center transition-colors",
        interactive && "cursor-pointer hover:bg-muted/30",
        isDragActive && "border-primary bg-primary/5",
        parseState === "parsed" && "border-solid bg-muted/40"
      )}
    >
      {parseState === "idle" && (
        <>
          <div className="mb-2 flex size-9 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <IconUpload className="size-4" />
          </div>
          <p className="text-sm font-medium">拖拽 ZIP 到此处或点击上传</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            仅支持 .zip 文件
          </p>
        </>
      )}

      {parseState === "parsing" && (
        <>
          <div className="mb-2 flex size-9 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <IconLoader2 className="size-4 animate-spin" />
          </div>
          <p className="truncate text-sm font-medium">{file?.name}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">解析中...</p>
        </>
      )}

      {parseState === "parsed" && (
        <>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="absolute top-1.5 right-1.5"
            onClick={(e) => {
              e.stopPropagation()
              onPickFile()
            }}
            aria-label="重新选择"
            title="重新选择"
          >
            <IconRefresh className="size-3.5" />
          </Button>
          <div className="mb-2 flex size-9 items-center justify-center rounded-md bg-primary/10 text-primary">
            <IconFileTypeZip className="size-5" />
          </div>
          <p className="line-clamp-2 max-w-full px-6 text-sm font-medium break-all">
            {file?.name}
          </p>
          <p className="mt-1 flex items-center justify-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400">
            <IconCircleCheckFilled className="size-3" />
            <span>
              文件上传并解析成功
              {fileSizeLabel ? `（${fileSizeLabel}）` : ""}
            </span>
          </p>
        </>
      )}
    </div>
  )
}
