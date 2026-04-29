import * as React from "react"
import {
  IconPackage,
  IconSearch,
  IconSparkles,
} from "@tabler/icons-react"
import { Badge } from "@workspace/ui/components/badge"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { Input } from "@workspace/ui/components/input"
import { cn } from "@workspace/ui/lib/utils"
import { fetchSkillList } from "@/api/employee"
import { fetchLocalSkillDetail } from "@/api/skill"
import type { SkillListItem, LocalSkillDetail } from "@/api/types"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { Separator } from "@workspace/ui/components/separator"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@workspace/ui/components/sheet"
import { ImportSkillDialog } from "./import-skill-dialog"

function SkillCard({
  skill,
  onClick,
}: {
  skill: SkillListItem
  onClick: () => void
}) {
  const isLocal = skill.source === "local"
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
        <Badge
          variant={isLocal ? "outline" : "secondary"}
          className="shrink-0 px-1.5 py-0 text-[10px]"
        >
          {skill.sourceLabel || (isLocal ? "本地" : "远程")}
        </Badge>
      </div>
      <span className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
        {skill.description || (isLocal ? skill.skillName : "暂无描述")}
      </span>
      {skill.directoryName && !isLocal && (
        <Badge variant="outline" className="w-fit px-1.5 py-0 text-[10px]">
          {skill.directoryName}
        </Badge>
      )}
    </button>
  )
}

function SkillDetailPanel({
  skill,
  open,
  onOpenChange,
}: {
  skill: SkillListItem | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [localDetail, setLocalDetail] = React.useState<LocalSkillDetail | null>(
    null
  )
  const [loadingLocal, setLoadingLocal] = React.useState(false)

  React.useEffect(() => {
    if (open && skill?.source === "local") {
      setLoadingLocal(true)
      setLocalDetail(null)
      fetchLocalSkillDetail(skill.skillName)
        .then(setLocalDetail)
        .catch(() => setLocalDetail(null))
        .finally(() => setLoadingLocal(false))
    }
    if (!open) setLocalDetail(null)
  }, [open, skill])

  if (!skill) return null

  const isLocal = skill.source === "local"

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full min-w-0 flex-col gap-0 p-0 sm:max-w-xl">
        <SheetHeader className="border-b px-6 pt-6 pb-5 text-left">
          <div className="space-y-3">
            <div className="flex min-w-0 items-center gap-2">
              <IconSparkles className="size-4 text-primary" />
              <SheetTitle className="min-w-0 break-all pr-8 text-lg leading-tight font-semibold">
                {skill.displayNameZh || skill.skillName}
              </SheetTitle>
            </div>
            <div className="flex items-center gap-2">
              <Badge
                variant={isLocal ? "outline" : "secondary"}
                className="px-1.5 py-0 text-[10px]"
              >
                {skill.sourceLabel || (isLocal ? "本地" : "远程")}
              </Badge>
              <p className="text-xs text-muted-foreground">
                {isLocal ? "本地技能详情" : "远程技能详情"}
              </p>
            </div>
          </div>
        </SheetHeader>

        <ScrollArea className="min-h-0 flex-1 bg-muted/10 px-6 py-6">
          {isLocal ? (
            loadingLocal ? (
              <div className="space-y-4 rounded-lg border bg-background p-4">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-24 w-full" />
              </div>
            ) : localDetail ? (
              <div className="space-y-6">
                {localDetail.importedAt && (
                  <div className="space-y-1.5 rounded-lg border bg-background p-4 shadow-sm">
                    <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                      导入时间
                    </h4>
                    <p className="break-all text-sm leading-relaxed">
                      {new Date(localDetail.importedAt).toLocaleString("zh-CN")}
                    </p>
                  </div>
                )}
                {localDetail.files.length > 0 && (
                  <div className="space-y-2 rounded-lg border bg-background p-4 shadow-sm">
                    <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                      文件列表
                    </h4>
                    <div className="rounded-md border bg-muted/30 p-3">
                      {localDetail.files.map((f) => (
                        <p
                          key={f}
                          className="break-all font-mono text-xs leading-relaxed text-muted-foreground"
                        >
                          {f}
                        </p>
                      ))}
                    </div>
                  </div>
                )}
                {localDetail.skillMdContent && (
                  <div className="space-y-2">
                    <Separator />
                    <div className="space-y-2 rounded-lg border bg-background p-4 shadow-sm">
                      <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                        SKILL.md
                      </h4>
                      <pre className="max-h-80 overflow-auto rounded-md border bg-muted/30 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">
                        {localDetail.skillMdContent}
                      </pre>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="rounded-lg border border-dashed bg-background p-4 text-sm text-muted-foreground">
                无法加载技能详情
              </p>
            )
          ) : (
            <div className="space-y-6">
              {skill.description && (
                <div className="space-y-1.5 rounded-lg border bg-background p-4">
                  <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    描述
                  </h4>
                  <p className="break-all text-sm leading-relaxed">
                    {skill.description}
                  </p>
                </div>
              )}
              {skill.skillName && (
                <div className="space-y-1.5 rounded-lg border bg-background p-4">
                  <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    技能名称
                  </h4>
                  <p className="break-all font-mono text-sm">{skill.skillName}</p>
                </div>
              )}
              {skill.directoryName && (
                <div className="space-y-1.5 rounded-lg border bg-background p-4">
                  <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    所属目录
                  </h4>
                  <p className="break-all text-sm leading-relaxed">
                    {skill.directoryName}
                  </p>
                </div>
              )}
              {skill.prompt && (
                <div className="space-y-2">
                  <Separator />
                  <div className="space-y-2 rounded-lg border bg-background p-4">
                    <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                      Prompt
                    </h4>
                    <pre className="max-h-80 overflow-auto rounded-md border bg-muted/30 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">
                      {skill.prompt}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  )
}

export function SkillsPage({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const [tab, setTab] = React.useState<"remote" | "local">("local")
  const [allSkills, setAllSkills] = React.useState<SkillListItem[]>([])
  const [loading, setLoading] = React.useState(true)
  const [searchQuery, setSearchQuery] = React.useState("")
  const [selectedSkill, setSelectedSkill] = React.useState<SkillListItem | null>(
    null
  )
  const [importOpen, setImportOpen] = React.useState(false)

  React.useEffect(() => {
    setLoading(true)
    fetchSkillList()
      .then(setAllSkills)
      .catch(() => setAllSkills([]))
      .finally(() => setLoading(false))
  }, [])

  const handleImportSuccess = () => {
    setLoading(true)
    fetchSkillList()
      .then(setAllSkills)
      .catch(() => setAllSkills([]))
      .finally(() => setLoading(false))
  }

  const remoteSkills = React.useMemo(
    () => allSkills.filter((s) => s.source !== "local"),
    [allSkills]
  )
  const localSkills = React.useMemo(
    () => allSkills.filter((s) => s.source === "local"),
    [allSkills]
  )

  const filteredRemote = React.useMemo(() => {
    if (!searchQuery.trim()) return remoteSkills
    const q = searchQuery.toLowerCase()
    return remoteSkills.filter(
      (item) =>
        item.skillName.toLowerCase().includes(q) ||
        item.description?.toLowerCase().includes(q) ||
        item.displayNameZh?.toLowerCase().includes(q) ||
        item.directoryName?.toLowerCase().includes(q)
    )
  }, [remoteSkills, searchQuery])

  const filteredLocal = React.useMemo(() => {
    if (!searchQuery.trim()) return localSkills
    const q = searchQuery.toLowerCase()
    return localSkills.filter(
      (item) =>
        item.skillName.toLowerCase().includes(q) ||
        item.description?.toLowerCase().includes(q)
    )
  }, [localSkills, searchQuery])

  return (
    <div
      className={cn("flex h-full w-full flex-col bg-background", className)}
      {...props}
    >
      <Tabs
        value={tab}
        onValueChange={(v) => {
          setTab(v as "remote" | "local")
          setSearchQuery("")
        }}
        className="flex min-h-0 flex-1 flex-col"
      >
        <header className="flex shrink-0 items-center gap-4 border-b px-6 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <IconPackage className="size-5 text-primary" />
            <h1 className="text-lg font-semibold">技能管理</h1>
          </div>

          <TabsList className="ml-2 h-9 w-auto rounded-md bg-muted/70 p-1">

            <TabsTrigger
              value="local"
              className="h-7 gap-1.5 rounded-md px-3 text-xs text-muted-foreground data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm"
            >
              本地技能
              <span className="text-xs text-muted-foreground">
                ({localSkills.length})
              </span>
            </TabsTrigger>
            <TabsTrigger
              value="remote"
              className="h-7 gap-1.5 rounded-md px-3 text-xs text-muted-foreground data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm"
            >
              远程技能
              <span className="text-xs text-muted-foreground">
                ({remoteSkills.length})
              </span>
            </TabsTrigger>
          </TabsList>

          <div className="ml-auto flex w-full max-w-80 items-center gap-2">
            <div className="relative flex-1">
              <IconSearch className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-7.5 rounded-md pl-7 text-xs"
                placeholder={`搜索${tab === "remote" ? "远程" : "本地"}技能...`}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            {tab === "local" && (
              <ImportSkillDialog
                open={importOpen}
                onOpenChange={setImportOpen}
                onSuccess={handleImportSuccess}
                trigger
              />
            )}
          </div>
        </header>

        <ScrollArea className="min-h-0 flex-1">
          <TabsContent value="remote" className="m-0 p-6">
            <SkillGrid
              skills={filteredRemote}
              loading={loading}
              searchQuery={searchQuery}
              onSelect={setSelectedSkill}
            />
          </TabsContent>
          <TabsContent value="local" className="m-0 p-6">
            <SkillGrid
              skills={filteredLocal}
              loading={loading}
              searchQuery={searchQuery}
              onSelect={setSelectedSkill}
              emptyText="暂无本地技能，点击「导入技能」添加"
            />
          </TabsContent>
        </ScrollArea>
      </Tabs>

      <SkillDetailPanel
        skill={selectedSkill}
        open={!!selectedSkill}
        onOpenChange={(open) => {
          if (!open) setSelectedSkill(null)
        }}
      />
    </div>
  )
}

function SkillGrid({
  skills,
  loading,
  searchQuery,
  onSelect,
  emptyText,
}: {
  skills: SkillListItem[]
  loading: boolean
  searchQuery: string
  onSelect: (skill: SkillListItem) => void
  emptyText?: string
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <span className="text-sm">加载中...</span>
      </div>
    )
  }

  if (skills.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <IconSearch className="size-8 stroke-1" />
        <p className="mt-2 text-sm">
          {searchQuery ? "没有找到匹配的技能" : emptyText || "暂无技能"}
        </p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-3 gap-4 min-[1600px]:grid-cols-4">
      {skills.map((skill) => (
        <SkillCard key={skill.id} skill={skill} onClick={() => onSelect(skill)} />
      ))}
    </div>
  )
}
