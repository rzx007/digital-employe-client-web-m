import * as React from "react"
import {
  IconArrowLeft,
  IconPackage,
  IconSearch,
  IconSparkles,
} from "@tabler/icons-react"
import { useQueryClient } from "@tanstack/react-query"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Textarea } from "@workspace/ui/components/textarea"
import { cn } from "@workspace/ui/lib/utils"
import type { SkillListItem } from "@/api/types"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { useSkillListQuery, useLocalSkillDetailQuery } from "@/hooks/use-skill-queries"
import { chatKeys } from "@/lib/query-keys/chat"
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

function SkillDetailView({
  skill,
  onBack,
}: {
  skill: SkillListItem
  onBack: () => void
}) {
  const isLocal = skill.source === "local"
  const { data: localDetail, isLoading: loadingLocal } =
    useLocalSkillDetailQuery(isLocal ? skill.skillName : null)

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onBack()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onBack])

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
            {skill.displayNameZh || skill.skillName}
          </h2>
          <Badge
            variant={isLocal ? "outline" : "secondary"}
            className="shrink-0 px-1.5 py-0 text-[10px]"
          >
            {skill.sourceLabel || (isLocal ? "本地" : "远程")}
          </Badge>
        </div>
      </header>

      <ScrollArea className="min-h-0 flex-1 bg-muted/10">
        <div className="mx-auto w-full max-w-4xl px-4 py-4 sm:px-6">
          {isLocal ? (
            loadingLocal ? (
              <div className="flex flex-col gap-3">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-24 w-full" />
              </div>
            ) : localDetail ? (
              <div className="flex flex-col gap-3">
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
  const [tab, setTab] = React.useState<"remote" | "local">("local")
  const [searchQuery, setSearchQuery] = React.useState("")
  const [selectedSkill, setSelectedSkill] = React.useState<SkillListItem | null>(
    null
  )
  const [importOpen, setImportOpen] = React.useState(false)

  const { data: allSkills = [], isLoading: loading } = useSkillListQuery()

  const handleImportSuccess = () => {
    queryClient.invalidateQueries({ queryKey: chatKeys.skills() })
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
      {selectedSkill ? (
        <SkillDetailView
          skill={selectedSkill}
          onBack={() => setSelectedSkill(null)}
        />
      ) : (
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
      )}
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
