import * as React from "react"
import {
  IconArrowLeft,
  IconCopy,
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
import { SkillMarkdownEditor } from "./skill-markdown-editor"
import { isInstalledSource, sourceBadgeProps } from "./skill-utils"

type SkillSource = SkillListItem["source"]
type SaveTarget = "workspace" | "builtin"

export function SkillDetailView({
  skill,
  onBack,
}: {
  skill: SkillListItem
  onBack: () => void
}) {
  const queryClient = useQueryClient()
  const [deleting, setDeleting] = React.useState(false)
  const [saving, setSaving] = React.useState<SaveTarget | null>(null)
  // 内置技能"复制另存"成功后，本工作区视角下它已变为本地技能。
  const [sourceOverride, setSourceOverride] =
    React.useState<SkillSource | null>(null)
  const [editorMaximized, setEditorMaximized] = React.useState(false)
  const isInstalled = isInstalledSource(skill)
  const effectiveSource = sourceOverride ?? skill.source
  const isBuiltin = effectiveSource === "builtin"
  const { data: localDetail, isLoading: loadingLocal } =
    useLocalSkillDetailQuery(isInstalled ? skill.skillName : null)
  const canDelete = effectiveSource === "local"
  const canEdit = isInstalled && Boolean(localDetail)
  const isSaving = saving !== null

  const savedDisplayNameZh =
    localDetail?.displayNameZh ?? skill.displayNameZh ?? ""
  const savedSkillMd = localDetail?.skillMdContent ?? ""

  const [displayNameZhDraft, setDisplayNameZhDraft] =
    React.useState(savedDisplayNameZh)
  const [skillMdDraft, setSkillMdDraft] = React.useState(savedSkillMd)
  // 服务端保存值变化时（详情加载完成或保存后）在渲染期对齐草稿，
  // 避免在 effect 内同步 setState 触发级联渲染。
  const [syncedSaved, setSyncedSaved] = React.useState({
    zh: savedDisplayNameZh,
    md: savedSkillMd,
  })
  if (syncedSaved.zh !== savedDisplayNameZh || syncedSaved.md !== savedSkillMd) {
    setSyncedSaved({ zh: savedDisplayNameZh, md: savedSkillMd })
    setDisplayNameZhDraft(savedDisplayNameZh)
    setSkillMdDraft(savedSkillMd)
  }

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

  const invalidateSkillQueries = async () => {
    await queryClient.invalidateQueries({ queryKey: chatKeys.skills() })
    await queryClient.invalidateQueries({
      queryKey: chatKeys.skillsPickerLocal(),
    })
    await queryClient.invalidateQueries({
      queryKey: chatKeys.localSkillDetail(skill.skillName),
    })
  }

  const handleSave = async (target?: SaveTarget) => {
    if (!canEdit || isSaving || !isDirty) return
    // 本地技能直接写工作区副本；内置技能必须显式选择 复制另存 / 覆盖保存。
    const effectiveTarget: SaveTarget = isBuiltin
      ? (target ?? "workspace")
      : "workspace"
    setSaving(effectiveTarget)
    try {
      const result = await updateLocalSkill(skill.skillName, {
        displayNameZh: displayNameZhDraft.trim(),
        skillMdContent: skillMdDraft,
        target: isBuiltin ? effectiveTarget : undefined,
      })
      setDisplayNameZhDraft(result.displayNameZh ?? "")
      if (result.skillMdContent != null) {
        setSkillMdDraft(result.skillMdContent)
      }
      const forkedToWorkspace = isBuiltin && result.isBuiltin === false
      if (forkedToWorkspace) {
        // 内置技能已复制到工作区，本视图后续按本地技能处理（可再编辑、可删除）。
        setSourceOverride("local")
      }
      const synced = result.syncedEmployeeCount ?? 0
      const base = forkedToWorkspace
        ? "已复制到当前工作区并保存"
        : effectiveTarget === "builtin"
          ? "已覆盖内置技能"
          : "已保存"
      toast.success(synced > 0 ? `${base}，并同步至 ${synced} 名员工` : base)
      await invalidateSkillQueries()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "保存失败，请稍后重试"
      toast.error(msg)
    } finally {
      setSaving(null)
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
          <Badge {...sourceBadgeProps(effectiveSource)}>
            {effectiveSource === "builtin"
              ? "内置"
              : effectiveSource === "local"
                ? "本地"
                : skill.sourceLabel || "远程"}
          </Badge>
          {canEdit &&
            (isBuiltin ? (
              <>
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  className="shrink-0 gap-1"
                  disabled={!isDirty || isSaving}
                  onClick={() => void handleSave("workspace")}
                  title="复制到当前工作区后保存，不影响全局内置技能"
                >
                  {saving === "workspace" ? (
                    <IconLoader2 className="size-3.5 animate-spin" />
                  ) : (
                    <IconCopy className="size-3.5" />
                  )}
                  复制另存
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0 gap-1"
                  disabled={!isDirty || isSaving}
                  onClick={() => void handleSave("builtin")}
                  title="直接修改全局内置技能，所有工作区共享此改动"
                >
                  {saving === "builtin" ? (
                    <IconLoader2 className="size-3.5 animate-spin" />
                  ) : (
                    <IconDeviceFloppy className="size-3.5" />
                  )}
                  覆盖保存
                </Button>
              </>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0 gap-1"
                disabled={!isDirty || isSaving}
                onClick={() => void handleSave()}
              >
                {isSaving ? (
                  <IconLoader2 className="size-3.5 animate-spin" />
                ) : (
                  <IconDeviceFloppy className="size-3.5" />
                )}
                保存
              </Button>
            ))}
          {canDelete && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0 gap-1 text-destructive hover:bg-destructive/10 hover:text-destructive"
              disabled={deleting || isSaving}
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

      {editorMaximized && isInstalled && localDetail ? (
        <div className="min-h-0 flex-1 px-4 py-4 sm:px-6">
          <SkillMarkdownEditor
            value={skillMdDraft}
            onChange={setSkillMdDraft}
            disabled={isSaving}
            maximized
            onToggleMaximize={() => setEditorMaximized(false)}
            className="h-full"
          />
        </div>
      ) : (
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
                    disabled={isSaving}
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
                  <SkillMarkdownEditor
                    value={skillMdDraft}
                    onChange={setSkillMdDraft}
                    disabled={isSaving}
                    onToggleMaximize={() => setEditorMaximized(true)}
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
      )}
    </div>
  )
}
