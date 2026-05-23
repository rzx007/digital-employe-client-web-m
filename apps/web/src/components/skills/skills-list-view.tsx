import * as React from "react"
import { IconPackage, IconSearch } from "@tabler/icons-react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { Separator } from "@workspace/ui/components/separator"
import { Input } from "@workspace/ui/components/input"
import type { SkillListItem } from "@/api/types"
import { installRemoteSkillToLocal } from "@/api/skill"
import { useSkillListQuery } from "@/hooks/use-skill-queries"
import { chatKeys } from "@/lib/query-keys/chat"
import { ImportSkillDialog } from "./import-skill-dialog"
import { InstalledSkillsSection } from "./installed-skills-section"
import { RemoteSkillsSection } from "./remote-skills-section"
import { useSkillGridColumnCount } from "./skill-grid"
import {
  buildRemoteCategories,
  filterRemoteByCategory,
  filterSkillsBySearch,
  isInstalledSource,
} from "./skill-utils"

export function SkillsListView({
  onSelectSkill,
}: {
  onSelectSkill: (skill: SkillListItem) => void
}) {
  const queryClient = useQueryClient()
  const [searchQuery, setSearchQuery] = React.useState("")
  const [remoteCategory, setRemoteCategory] = React.useState("全部")
  const [importOpen, setImportOpen] = React.useState(false)
  const [installedExpanded, setInstalledExpanded] = React.useState(false)
  const [installingId, setInstallingId] = React.useState<number | null>(null)

  const skillGridCols = useSkillGridColumnCount()
  const skeletonCount = skillGridCols * 2
  const installedCollapsedMax = skeletonCount

  const { data: allSkills = [], isLoading: loading } = useSkillListQuery()

  const handleImportSuccess = () => {
    queryClient.invalidateQueries({ queryKey: chatKeys.skills() })
    queryClient.invalidateQueries({ queryKey: chatKeys.skillsPickerLocal() })
  }

  const remoteSkills = React.useMemo(
    () => allSkills.filter((s) => s.source === "remote"),
    [allSkills]
  )
  const installedSkills = React.useMemo(
    () => allSkills.filter((s) => isInstalledSource(s)),
    [allSkills]
  )

  const remoteCategories = React.useMemo(
    () => buildRemoteCategories(remoteSkills),
    [remoteSkills]
  )

  React.useEffect(() => {
    if (!remoteCategories.includes(remoteCategory)) {
      setRemoteCategory("全部")
    }
  }, [remoteCategories, remoteCategory])

  const filteredInstalled = React.useMemo(
    () => filterSkillsBySearch(installedSkills, searchQuery),
    [installedSkills, searchQuery]
  )

  const remoteAfterSearch = React.useMemo(
    () =>
      filterSkillsBySearch(remoteSkills, searchQuery, {
        includeDirectoryAndTags: true,
      }),
    [remoteSkills, searchQuery]
  )

  const filteredRemote = React.useMemo(
    () => filterRemoteByCategory(remoteAfterSearch, remoteCategory),
    [remoteAfterSearch, remoteCategory]
  )

  const visibleInstalled = React.useMemo(
    () =>
      installedExpanded
        ? filteredInstalled
        : filteredInstalled.slice(0, installedCollapsedMax),
    [filteredInstalled, installedExpanded, installedCollapsedMax]
  )
  const showInstalledToggle = filteredInstalled.length > installedCollapsedMax

  const tryInstallRemote = async (skill: SkillListItem) => {
    setInstallingId(skill.id)
    try {
      await installRemoteSkillToLocal(skill.id)
      toast.success(`「${skill.displayNameZh || skill.skillName}」已安装到本地`)
      await queryClient.invalidateQueries({ queryKey: chatKeys.skills() })
      await queryClient.invalidateQueries({
        queryKey: chatKeys.skillsPickerLocal(),
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "安装失败"
      const conflict =
        /409|已存在|同名|CONFLICT/i.test(msg) || msg.includes("冲突")
      if (conflict) {
        const ok = window.confirm("本地已有同名技能，是否覆盖安装？")
        if (ok) {
          try {
            await installRemoteSkillToLocal(skill.id, { overwrite: true })
            toast.success(
              `「${skill.displayNameZh || skill.skillName}」已覆盖安装`
            )
            await queryClient.invalidateQueries({
              queryKey: chatKeys.skills(),
            })
            await queryClient.invalidateQueries({
              queryKey: chatKeys.skillsPickerLocal(),
            })
          } catch (e2: unknown) {
            toast.error(e2 instanceof Error ? e2.message : "覆盖安装失败")
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
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-4 border-b px-6 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <IconPackage className="size-5 text-primary" />
          <h1 className="text-lg font-semibold">技能管理</h1>
        </div>

        <div className="ml-auto flex w-full max-w-md min-w-[240px] flex-1 items-center gap-2 sm:max-w-lg">
          <div className="relative flex-1">
            <IconSearch className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-7.5 rounded-md pl-7 text-xs"
              placeholder="搜索已安装或远程技能…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <ImportSkillDialog
            open={importOpen}
            onOpenChange={setImportOpen}
            onSuccess={handleImportSuccess}
            trigger
          />
        </div>
      </header>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-10 p-6">
          <InstalledSkillsSection
            loading={loading}
            searchQuery={searchQuery}
            filteredCount={filteredInstalled.length}
            skills={visibleInstalled}
            showToggle={showInstalledToggle}
            expanded={installedExpanded}
            onToggleExpanded={() => setInstalledExpanded((v) => !v)}
            skeletonCount={skeletonCount}
            onSelectSkill={onSelectSkill}
          />

          <Separator className="shrink-0 bg-border/70" />

          <RemoteSkillsSection
            loading={loading}
            searchQuery={searchQuery}
            remoteCategory={remoteCategory}
            filteredCount={filteredRemote.length}
            categories={remoteCategories}
            skills={filteredRemote}
            skeletonCount={skeletonCount}
            installingId={installingId}
            onCategoryChange={setRemoteCategory}
            onSelectSkill={onSelectSkill}
            onInstall={(skill) => void tryInstallRemote(skill)}
          />
        </div>
      </ScrollArea>
    </div>
  )
}
