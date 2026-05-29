import * as React from "react"
import {
  IconArrowLeft,
  IconDeviceFloppy,
  IconLoader2,
  IconSparkles,
  IconTrash,
} from "@tabler/icons-react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Textarea } from "@workspace/ui/components/textarea"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { cn } from "@workspace/ui/lib/utils"
import type { SkillListItem } from "@/api/types"
import { deleteWorkspaceLocalSkill, updateLocalSkill } from "@/api/skill"
import { useLocalSkillDetailQuery } from "@/hooks/use-skill-queries"
import { chatKeys } from "@/lib/query-keys/chat"
import { isInstalledSource, sourceBadgeProps } from "./skill-utils"

export function SkillDetailView({
  skill,
  onBack,
}: {
  skill: SkillListItem
  onBack: () => void
}) {
  const queryClient = useQueryClient()
  const [deleting, setDeleting] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [displayNameZhDraft, setDisplayNameZhDraft] = React.useState("")
  const [skillMdDraft, setSkillMdDraft] = React.useState("")
  const isInstalled = isInstalledSource(skill)
  const { data: localDetail, isLoading: loadingLocal } =
    useLocalSkillDetailQuery(isInstalled ? skill.skillName : null)
  const canDelete = skill.source === "local"
  const canEdit = isInstalled && Boolean(localDetail)

  const savedDisplayNameZh =
    localDetail?.displayNameZh ?? skill.displayNameZh ?? ""
  const savedSkillMd = localDetail?.skillMdContent ?? ""

  React.useEffect(() => {
    setDisplayNameZhDraft(savedDisplayNameZh)
  }, [savedDisplayNameZh])

  React.useEffect(() => {
    setSkillMdDraft(savedSkillMd)
  }, [savedSkillMd])

  const isDirty =
    displayNameZhDraft.trim() !== savedDisplayNameZh.trim() ||
    skillMdDraft !== savedSkillMd

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onBack()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onBack])

  const title =
    displayNameZhDraft.trim() ||
    savedDisplayNameZh.trim() ||
    skill.skillName

  const readOnlyInputClass = "cursor-default bg-muted/30"
  const readOnlyDescTextareaClass = cn(
    "field-sizing-fixed max-h-36 min-h-20 cursor-default overflow-y-auto",
    "bg-muted/30"
  )
  const readOnlyInstructionTextareaClass = cn(
    "field-sizing-fixed max-h-[min(60vh,28rem)] min-h-32 cursor-default",
    "overflow-y-auto bg-muted/30 font-mono text-xs"
  )
  const readOnlyFilesTextareaClass = cn(
    "field-sizing-fixed max-h-48 min-h-20 cursor-default overflow-y-auto",
    "bg-muted/30 font-mono text-xs"
  )
  const editableSkillMdTextareaClass = cn(
    "field-sizing-fixed max-h-[min(60vh,28rem)] min-h-32 overflow-y-auto",
    "font-mono text-xs"
  )

  const invalidateSkillQueries = async () => {
    await queryClient.invalidateQueries({ queryKey: chatKeys.skills() })
    await queryClient.invalidateQueries({
      queryKey: chatKeys.skillsPickerLocal(),
    })
    await queryClient.invalidateQueries({
      queryKey: chatKeys.localSkillDetail(skill.skillName),
    })
  }

  const handleSave = async () => {
    if (!canEdit || saving || !isDirty) return
    setSaving(true)
    try {
      const result = await updateLocalSkill(skill.skillName, {
        displayNameZh: displayNameZhDraft.trim(),
        skillMdContent: skillMdDraft,
      })
      setDisplayNameZhDraft(result.displayNameZh ?? "")
      if (result.skillMdContent != null) {
        setSkillMdDraft(result.skillMdContent)
      }
      const synced = result.syncedEmployeeCount ?? 0
      toast.success(
        synced > 0 ? `已保存，并同步至 ${synced} 名员工` : "已保存"
      )
      await invalidateSkillQueries()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "保存失败，请稍后重试"
      toast.error(msg)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!canDelete || deleting) return
    const ok = window.confirm(
      `确定删除技能「${skill.skillName}」？将删除本地工作区目录中的文件，不可恢复。`
    )
    if (!ok) return
    setDeleting(true)
    try {
      await deleteWorkspaceLocalSkill(skill.skillName)
      toast.success("已删除本地技能")
      await invalidateSkillQueries()
      onBack()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "删除失败，请稍后重试"
      toast.error(msg)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b px-4 py-3 sm:px-6">
        <div className="mx-auto flex w-full items-center gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onBack}
            aria-label="返回"
            title="返回"
            className="-ml-1 shrink-0"
          >
            <IconArrowLeft className="size-4" />
          </Button>
          <IconSparkles className="size-4 shrink-0 text-primary" />
          <h2 className="min-w-0 flex-1 truncate text-base font-semibold">
            {title}
          </h2>
          <Badge {...sourceBadgeProps(skill.source)}>
            {skill.sourceLabel ||
              (skill.source === "builtin"
                ? "内置"
                : skill.source === "local"
                  ? "本地"
                  : "远程")}
          </Badge>
          {canEdit && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0 gap-1"
              disabled={!isDirty || saving}
              onClick={() => void handleSave()}
            >
              {saving ? (
                <IconLoader2 className="size-3.5 animate-spin" />
              ) : (
                <IconDeviceFloppy className="size-3.5" />
              )}
              保存
            </Button>
          )}
          {canDelete && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0 gap-1 text-destructive hover:bg-destructive/10 hover:text-destructive"
              disabled={deleting}
              onClick={() => void handleDelete()}
            >
              {deleting ? (
                <IconLoader2 className="size-3.5 animate-spin" />
              ) : (
                <IconTrash className="size-3.5" />
              )}
              删除
            </Button>
          )}
        </div>
      </header>

      <ScrollArea className="min-h-0 flex-1 bg-muted/10">
        <div className="mx-auto w-full max-w-4xl px-4 py-4 sm:px-6">
          {isInstalled ? (
            loadingLocal ? (
              <div className="flex flex-col gap-3">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-24 w-full" />
              </div>
            ) : localDetail ? (
              <div className="flex flex-col gap-3">
                {localDetail.skillName && (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="skill-detail-id-name">
                      技能 ID（目录名）
                    </Label>
                    <Input
                      id="skill-detail-id-name"
                      readOnly
                      value={localDetail.skillName}
                      className={cn(readOnlyInputClass, "font-mono text-xs")}
                    />
                  </div>
                )}
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="skill-detail-zh">中文名称</Label>
                  <Input
                    id="skill-detail-zh"
                    value={displayNameZhDraft}
                    onChange={(e) => setDisplayNameZhDraft(e.target.value)}
                    placeholder={skill.skillName}
                    maxLength={255}
                    disabled={saving}
                  />
                  <p className="text-xs text-muted-foreground">
                    留空时将显示技能 ID（目录名）
                  </p>
                </div>
                {localDetail.importedAt && (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="skill-detail-imported-at">导入时间</Label>
                    <Input
                      id="skill-detail-imported-at"
                      readOnly
                      value={new Date(localDetail.importedAt).toLocaleString(
                        "zh-CN"
                      )}
                      className={readOnlyInputClass}
                    />
                  </div>
                )}
                {localDetail.files.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="skill-detail-files">文件列表</Label>
                    <Textarea
                      id="skill-detail-files"
                      readOnly
                      rows={16}
                      value={localDetail.files.join("\n")}
                      className={readOnlyFilesTextareaClass}
                    />
                  </div>
                )}
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="skill-detail-md">SKILL.md</Label>
                  <Textarea
                    id="skill-detail-md"
                    rows={100}
                    value={skillMdDraft}
                    onChange={(e) => setSkillMdDraft(e.target.value)}
                    disabled={saving}
                    className={editableSkillMdTextareaClass}
                  />
                </div>
              </div>
            ) : (
              <p className="rounded-md border border-dashed bg-background p-4 text-sm text-muted-foreground">
                无法加载技能详情
              </p>
            )
          ) : (
            <div className="flex flex-col gap-3">
              {skill.skillName && (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="skill-detail-name">技能名称</Label>
                  <Input
                    id="skill-detail-name"
                    readOnly
                    value={skill.skillName}
                    className={cn(readOnlyInputClass, "font-mono text-xs")}
                  />
                </div>
              )}

              {skill.description && (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="skill-detail-description">描述</Label>
                  <Textarea
                    id="skill-detail-description"
                    readOnly
                    rows={4}
                    value={skill.description}
                    className={readOnlyDescTextareaClass}
                  />
                </div>
              )}

              {skill.prompt && (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="skill-detail-prompt">指令</Label>
                  <Textarea
                    id="skill-detail-prompt"
                    readOnly
                    rows={8}
                    value={skill.prompt}
                    className={readOnlyInstructionTextareaClass}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
