import * as React from "react"
import {
  IconArrowLeft,
  IconLoader2,
  IconPackage,
  IconSearch,
  IconSparkles,
  IconTrash,
} from "@tabler/icons-react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { Separator } from "@workspace/ui/components/separator"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Textarea } from "@workspace/ui/components/textarea"
import { cn } from "@workspace/ui/lib/utils"
import type { SkillListItem } from "@/api/types"
import {
  deleteWorkspaceLocalSkill,
  installRemoteSkillToLocal,
} from "@/api/skill"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { useSkillListQuery, useLocalSkillDetailQuery } from "@/hooks/use-skill-queries"
import { chatKeys } from "@/lib/query-keys/chat"
import { ImportSkillDialog } from "./import-skill-dialog"

/** 须与「已安装」网格类名 min-[1600px]:grid-cols-4 同步 */
const SKILL_GRID_WIDE_BREAKPOINT_PX = 1600

function getSkillGridColumnCount(): number {
  if (typeof window === "undefined") return 3
  return window.innerWidth >= SKILL_GRID_WIDE_BREAKPOINT_PX ? 4 : 3
}

function useSkillGridColumnCount(): number {
  const [cols, setCols] = React.useState(getSkillGridColumnCount)
  React.useEffect(() => {
    const query = `(min-width: ${SKILL_GRID_WIDE_BREAKPOINT_PX}px)`
    const mql = window.matchMedia(query)
    const sync = () => setCols(mql.matches ? 4 : 3)
    sync()
    mql.addEventListener("change", sync)
    return () => mql.removeEventListener("change", sync)
  }, [])
  return cols
}

function isInstalledSource(s: SkillListItem): boolean {
  return s.source === "local" || s.source === "builtin"
}

/** 本地 / 内置 / 远程 来源标签配色（浅色 + dark） */
function sourceBadgeClassName(
  source: SkillListItem["source"] | undefined,
): string {
  switch (source) {
    case "local":
      return cn(
        "border-sky-500/45 bg-sky-500/10 text-sky-900",
        "dark:border-sky-400/35 dark:bg-sky-400/15 dark:text-sky-100",
      )
    case "builtin":
      return cn(
        "border-amber-500/45 bg-amber-500/10 text-amber-950",
        "dark:border-amber-400/35 dark:bg-amber-400/15 dark:text-amber-50",
      )
    case "remote":
    default:
      return cn(
        "border-violet-500/45 bg-violet-500/10 text-violet-950",
        "dark:border-violet-400/35 dark:bg-violet-400/15 dark:text-violet-100/90",
      )
  }
}

function sourceBadgeProps(source: SkillListItem["source"] | undefined) {
  return {
    variant: "outline" as const,
    className: cn(
      "shrink-0 px-1.5 py-0 text-[10px] font-medium",
      sourceBadgeClassName(source),
    ),
  }
}

function buildRemoteCategories(skills: SkillListItem[]): string[] {
  const hasTag = skills.some((s) => (s.tags?.length ?? 0) > 0)
  if (hasTag) {
    const set = new Set<string>()
    let untagged = false
    for (const s of skills) {
      if (s.tags?.length) {
        for (const t of s.tags) {
          if (t.trim()) set.add(t.trim())
        }
      } else {
        untagged = true
      }
    }
    const sorted = [...set].sort((a, b) => a.localeCompare(b, "zh-CN"))
    return ["全部", ...sorted, ...(untagged ? ["未分类"] : [])]
  }
  const set = new Set<string>()
  for (const s of skills) {
    set.add(s.directoryName?.trim() || "未分类")
  }
  const sorted = [...set].sort((a, b) => a.localeCompare(b, "zh-CN"))
  return ["全部", ...sorted]
}

function filterRemoteByCategory(
  skills: SkillListItem[],
  category: string,
): SkillListItem[] {
  if (category === "全部") return skills
  const hasTag = skills.some((s) => (s.tags?.length ?? 0) > 0)
  if (hasTag) {
    if (category === "未分类") {
      return skills.filter((s) => !(s.tags?.length ?? 0))
    }
    return skills.filter((s) => s.tags?.includes(category))
  }
  return skills.filter(
    (s) => (s.directoryName?.trim() || "未分类") === category,
  )
}

function InstalledSkillCard({
  skill,
  onClick,
}: {
  skill: SkillListItem
  onClick: () => void
}) {
  const src = skill.source ?? "local"
  return (
    <button
      type="button"
      className="flex flex-col gap-2 rounded-sm border p-4 text-left transition-colors hover:border-primary/30 hover:bg-accent/30"
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="flex items-center gap-1.5 text-sm font-medium leading-snug">
          <IconSparkles className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="line-clamp-1">
            {skill.displayNameZh || skill.skillName}
          </span>
        </span>
        <Badge {...sourceBadgeProps(src)}>
          {skill.sourceLabel || (src === "builtin" ? "内置" : "本地")}
        </Badge>
      </div>
      <span className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
        {skill.description || skill.skillName}
      </span>
    </button>
  )
}

function RemoteSkillCard({
  skill,
  onSelect,
  onInstall,
  installing,
}: {
  skill: SkillListItem
  onSelect: () => void
  onInstall: () => void
  installing: boolean
}) {
  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col gap-2 rounded-sm border p-4",
        "transition-colors hover:border-primary/30 hover:bg-accent/30",
      )}
    >
      <button
        type="button"
        className="flex min-h-0 flex-1 flex-col gap-2 text-left"
        onClick={onSelect}
      >
        <div className="flex items-start justify-between gap-2">
          <span className="flex items-center gap-1.5 text-sm font-medium leading-snug">
            <IconSparkles className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="line-clamp-1">
              {skill.displayNameZh || skill.skillName}
            </span>
          </span>
          <Badge {...sourceBadgeProps("remote")}>
            {skill.sourceLabel || "远程"}
          </Badge>
        </div>
        <span className="line-clamp-2 min-h-10 text-xs leading-relaxed text-muted-foreground">
          {skill.description || "暂无描述"}
        </span>
        {skill.directoryName && (
          <Badge variant="outline" className="w-fit px-1.5 py-0 text-[10px]">
            {skill.directoryName}
          </Badge>
        )}
      </button>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="w-full shrink-0 text-xs"
        disabled={installing}
        onClick={(e) => {
          e.stopPropagation()
          onInstall()
        }}
      >
        {installing ? (
          <span className="flex items-center justify-center gap-1.5">
            <IconLoader2 className="size-3.5 animate-spin" />
            安装中…
          </span>
        ) : (
          "安装"
        )}
      </Button>
    </div>
  )
}

function SkillDetailView({
  skill,
  onBack,
}: {
  skill: SkillListItem
  onBack: () => void
}) {
  const queryClient = useQueryClient()
  const [deleting, setDeleting] = React.useState(false)
  const isInstalled = isInstalledSource(skill)
  const { data: localDetail, isLoading: loadingLocal } =
    useLocalSkillDetailQuery(isInstalled ? skill.skillName : null)
  const canDelete = skill.source === "local"

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onBack()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onBack])

  const title =
    localDetail?.displayNameZh ||
    skill.displayNameZh ||
    skill.skillName

  const readOnlyInputClass = "cursor-default bg-muted/30"
  const readOnlyDescTextareaClass = cn(
    "field-sizing-fixed max-h-36 min-h-20 cursor-default overflow-y-auto",
    "bg-muted/30",
  )
  const readOnlyInstructionTextareaClass = cn(
    "field-sizing-fixed min-h-32 max-h-[min(60vh,28rem)] cursor-default",
    "overflow-y-auto bg-muted/30 font-mono text-xs",
  )
  const readOnlyFilesTextareaClass = cn(
    "field-sizing-fixed min-h-20 max-h-48 cursor-default overflow-y-auto",
    "bg-muted/30 font-mono text-xs",
  )

  const handleDelete = async () => {
    if (!canDelete || deleting) return
    const ok = window.confirm(
      `确定删除技能「${skill.skillName}」？将删除本地工作区目录中的文件，不可恢复。`,
    )
    if (!ok) return
    setDeleting(true)
    try {
      await deleteWorkspaceLocalSkill(skill.skillName)
      toast.success("已删除本地技能")
      await queryClient.invalidateQueries({ queryKey: chatKeys.skills() })
      await queryClient.invalidateQueries({
        queryKey: chatKeys.skillsPickerLocal(),
      })
      onBack()
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "删除失败，请稍后重试"
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
                    <Label htmlFor="skill-detail-id-name">技能 ID（目录名）</Label>
                    <Input
                      id="skill-detail-id-name"
                      readOnly
                      value={localDetail.skillName}
                      className={cn(readOnlyInputClass, "font-mono text-xs")}
                    />
                  </div>
                )}
                {(localDetail.displayNameZh || skill.displayNameZh) && (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="skill-detail-zh">中文名称</Label>
                    <Input
                      id="skill-detail-zh"
                      readOnly
                      value={
                        localDetail.displayNameZh ||
                        skill.displayNameZh ||
                        ""
                      }
                      className={readOnlyInputClass}
                    />
                  </div>
                )}
                {localDetail.importedAt && (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="skill-detail-imported-at">导入时间</Label>
                    <Input
                      id="skill-detail-imported-at"
                      readOnly
                      value={new Date(localDetail.importedAt).toLocaleString(
                        "zh-CN",
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
                {localDetail.skillMdContent && (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="skill-detail-md">SKILL.md</Label>
                    <Textarea
                      id="skill-detail-md"
                      readOnly
                      rows={100}
                      value={localDetail.skillMdContent}
                      className={readOnlyInstructionTextareaClass}
                    />
                  </div>
                )}
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

export function SkillsPage({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const queryClient = useQueryClient()
  const [searchQuery, setSearchQuery] = React.useState("")
  const [remoteCategory, setRemoteCategory] = React.useState("全部")
  const [selectedSkill, setSelectedSkill] = React.useState<SkillListItem | null>(
    null,
  )
  const [importOpen, setImportOpen] = React.useState(false)
  const [installedExpanded, setInstalledExpanded] = React.useState(false)
  const [installingId, setInstallingId] = React.useState<number | null>(null)

  const skillGridCols = useSkillGridColumnCount()
  const installedCollapsedMax = skillGridCols * 2

  const { data: allSkills = [], isLoading: loading } = useSkillListQuery()

  const handleImportSuccess = () => {
    queryClient.invalidateQueries({ queryKey: chatKeys.skills() })
    queryClient.invalidateQueries({ queryKey: chatKeys.skillsPickerLocal() })
  }

  const remoteSkills = React.useMemo(
    () => allSkills.filter((s) => s.source === "remote"),
    [allSkills],
  )
  const installedSkills = React.useMemo(
    () => allSkills.filter((s) => isInstalledSource(s)),
    [allSkills],
  )

  const remoteCategories = React.useMemo(
    () => buildRemoteCategories(remoteSkills),
    [remoteSkills],
  )

  React.useEffect(() => {
    if (!remoteCategories.includes(remoteCategory)) {
      setRemoteCategory("全部")
    }
  }, [remoteCategories, remoteCategory])

  const filteredInstalled = React.useMemo(() => {
    if (!searchQuery.trim()) return installedSkills
    const q = searchQuery.toLowerCase()
    return installedSkills.filter(
      (item) =>
        item.skillName.toLowerCase().includes(q) ||
        item.description?.toLowerCase().includes(q) ||
        item.displayNameZh?.toLowerCase().includes(q),
    )
  }, [installedSkills, searchQuery])

  const remoteAfterSearch = React.useMemo(() => {
    if (!searchQuery.trim()) return remoteSkills
    const q = searchQuery.toLowerCase()
    return remoteSkills.filter(
      (item) =>
        item.skillName.toLowerCase().includes(q) ||
        item.description?.toLowerCase().includes(q) ||
        item.displayNameZh?.toLowerCase().includes(q) ||
        item.directoryName?.toLowerCase().includes(q) ||
        item.tags?.some((t) => t.toLowerCase().includes(q)),
    )
  }, [remoteSkills, searchQuery])

  const filteredRemote = React.useMemo(
    () => filterRemoteByCategory(remoteAfterSearch, remoteCategory),
    [remoteAfterSearch, remoteCategory],
  )

  const visibleInstalled = React.useMemo(
    () =>
      installedExpanded
        ? filteredInstalled
        : filteredInstalled.slice(0, installedCollapsedMax),
    [filteredInstalled, installedExpanded, installedCollapsedMax],
  )
  const showInstalledToggle =
    filteredInstalled.length > installedCollapsedMax

  const tryInstallRemote = async (skill: SkillListItem) => {
    setInstallingId(skill.id)
    try {
      await installRemoteSkillToLocal(skill.id)
      toast.success(
        `「${skill.displayNameZh || skill.skillName}」已安装到本地`,
      )
      await queryClient.invalidateQueries({ queryKey: chatKeys.skills() })
      await queryClient.invalidateQueries({
        queryKey: chatKeys.skillsPickerLocal(),
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "安装失败"
      const conflict =
        /409|已存在|同名|CONFLICT/i.test(msg) || msg.includes("冲突")
      if (conflict) {
        const ok = window.confirm(
          "本地已有同名技能，是否覆盖安装？",
        )
        if (ok) {
          try {
            await installRemoteSkillToLocal(skill.id, { overwrite: true })
            toast.success(
              `「${skill.displayNameZh || skill.skillName}」已覆盖安装`,
            )
            await queryClient.invalidateQueries({
              queryKey: chatKeys.skills(),
            })
            await queryClient.invalidateQueries({
              queryKey: chatKeys.skillsPickerLocal(),
            })
          } catch (e2: unknown) {
            toast.error(
              e2 instanceof Error ? e2.message : "覆盖安装失败",
            )
          }
        }
      } else {
        toast.error(msg)
      }
    } finally {
      setInstallingId(null)
    }
  }

  return (
    <div
      className={cn("flex h-full w-full flex-col bg-background", className)}
      {...props}
    >
      {selectedSkill ? (
        <SkillDetailView
          skill={selectedSkill}
          onBack={() => setSelectedSkill(null)}
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <header className="flex shrink-0 flex-wrap items-center gap-4 border-b px-6 py-3">
            <div className="flex min-w-0 items-center gap-2">
              <IconPackage className="size-5 text-primary" />
              <h1 className="text-lg font-semibold">技能管理</h1>
            </div>

            <div className="ml-auto flex w-full min-w-[240px] max-w-md flex-1 items-center gap-2 sm:max-w-lg">
              <div className="relative flex-1">
                <IconSearch className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="h-7.5 rounded-md pl-7 text-xs"
                  placeholder="搜索已安装或远程技能…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>
          </header>

          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-10 p-6">
              <section className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-sm font-semibold text-foreground">
                    已安装
                    <span className="ml-1.5 font-normal text-muted-foreground">
                      ({filteredInstalled.length})
                    </span>
                  </h2>
                  <ImportSkillDialog
                    open={importOpen}
                    onOpenChange={setImportOpen}
                    onSuccess={handleImportSuccess}
                    trigger
                  />
                </div>

                {loading ? (
                  <div className="flex justify-center py-12 text-sm text-muted-foreground">
                    加载中…
                  </div>
                ) : filteredInstalled.length === 0 ? (
                  <div className="flex flex-col items-center justify-center rounded-md border border-dashed py-12 text-muted-foreground">
                    <IconSearch className="size-8 stroke-1" />
                    <p className="mt-2 text-sm">
                      {searchQuery
                        ? "没有找到匹配的已安装技能"
                        : "暂无已安装技能，点击「导入」添加 ZIP 包"}
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-3 gap-4 min-[1600px]:grid-cols-4">
                      {visibleInstalled.map((skill) => (
                        <InstalledSkillCard
                          key={`${skill.source}-${skill.id}-${skill.skillName}`}
                          skill={skill}
                          onClick={() => setSelectedSkill(skill)}
                        />
                      ))}
                    </div>
                    {showInstalledToggle && (
                      <div className="flex w-full justify-center pt-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-xs text-muted-foreground"
                          onClick={() =>
                            setInstalledExpanded((v) => !v)
                          }
                        >
                          {installedExpanded ? "收起" : "显示更多"}
                        </Button>
                      </div>
                    )}
                  </>
                )}
              </section>

              <Separator className="shrink-0 bg-border/70" />

              <section className="space-y-3">
                <h2 className="text-sm font-semibold text-foreground">
                  远程技能
                  <span className="ml-1.5 font-normal text-muted-foreground">
                    ({filteredRemote.length})
                  </span>
                </h2>

                {remoteCategories.length > 1 && (
                  <div className="flex flex-wrap gap-2">
                    {remoteCategories.map((cat) => (
                      <Button
                        key={cat}
                        type="button"
                        variant={
                          remoteCategory === cat ? "secondary" : "outline"
                        }
                        size="sm"
                        className="h-7 rounded-full px-3 text-xs"
                        onClick={() => setRemoteCategory(cat)}
                      >
                        {cat}
                      </Button>
                    ))}
                  </div>
                )}

                {loading ? (
                  <div className="flex justify-center py-12 text-sm text-muted-foreground">
                    加载中…
                  </div>
                ) : filteredRemote.length === 0 ? (
                  <div className="flex flex-col items-center justify-center rounded-md border border-dashed py-12 text-muted-foreground">
                    <IconSearch className="size-8 stroke-1" />
                    <p className="mt-2 text-sm">
                      {searchQuery || remoteCategory !== "全部"
                        ? "当前分类下没有匹配的技能"
                        : "暂无远程技能"}
                    </p>
                  </div>
                ) : (
                  <div className="grid auto-rows-fr grid-cols-3 gap-4 min-[1600px]:grid-cols-4">
                    {filteredRemote.map((skill) => (
                      <RemoteSkillCard
                        key={skill.id}
                        skill={skill}
                        onSelect={() => setSelectedSkill(skill)}
                        onInstall={() => void tryInstallRemote(skill)}
                        installing={installingId === skill.id}
                      />
                    ))}
                  </div>
                )}
              </section>
            </div>
          </ScrollArea>
        </div>
      )}
    </div>
  )
}
