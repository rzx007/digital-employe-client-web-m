import * as React from "react"
import { IconCloudUpload, IconPackage, IconSearch, IconTrash } from "@tabler/icons-react"
import { toast } from "sonner"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import {
  fetchLocalSkillList,
  uploadLocalSkillToRemote,
} from "@/api/skill"
import type { LocalSkillItem } from "@/api/types"
import { ImportSkillDialog } from "./import-skill-dialog"
import { LocalSkillDetailDialog } from "./local-skill-detail-dialog"

export function LocalSkillList() {
  const [skills, setSkills] = React.useState<LocalSkillItem[]>([])
  const [loading, setLoading] = React.useState(true)
  const [searchQuery, setSearchQuery] = React.useState("")
  const [importOpen, setImportOpen] = React.useState(false)
  const [detailSkill, setDetailSkill] = React.useState<LocalSkillItem | null>(
    null
  )
  const [uploading, setUploading] = React.useState<string | null>(null)

  const loadSkills = React.useCallback(() => {
    setLoading(true)
    fetchLocalSkillList()
      .then(setSkills)
      .catch(() => setSkills([]))
      .finally(() => setLoading(false))
  }, [])

  React.useEffect(() => {
    loadSkills()
  }, [loadSkills])

  const filteredSkills = React.useMemo(() => {
    if (!searchQuery.trim()) return skills
    const q = searchQuery.toLowerCase()
    return skills.filter(
      (item) =>
        item.skillName.toLowerCase().includes(q) ||
        item.path.toLowerCase().includes(q)
    )
  }, [skills, searchQuery])

  const handleUploadToRemote = async (skill: LocalSkillItem) => {
    setUploading(skill.skillName)
    try {
      await uploadLocalSkillToRemote({ skillName: skill.skillName })
      toast.success(`技能「${skill.skillName}」已上传到远程`)
    } catch {
      toast.error(`上传失败：${skill.skillName}`)
    } finally {
      setUploading(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <IconSearch className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="搜索本地技能..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <Button
          size="sm"
          className="gap-1.5"
          onClick={() => setImportOpen(true)}
        >
          <IconPackage className="size-3.5" />
          导入技能
        </Button>
        <span className="shrink-0 text-sm text-muted-foreground">
          共 {filteredSkills.length} 项
        </span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <span className="text-sm">加载中...</span>
        </div>
      ) : filteredSkills.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <IconPackage className="size-8 stroke-1" />
          <p className="mt-2 text-sm">
            {searchQuery ? "没有找到匹配的技能" : "暂无本地技能，点击「导入技能」添加"}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          {filteredSkills.map((skill) => (
            <div
              key={skill.skillName}
              className="flex flex-col gap-2 rounded-lg border p-4 transition-colors hover:border-primary/30 hover:bg-accent/30"
            >
              <div className="flex items-start justify-between gap-2">
                <button
                  type="button"
                  className="flex-1 text-left"
                  onClick={() => setDetailSkill(skill)}
                >
                  <span className="text-sm font-medium leading-snug hover:underline">
                    {skill.skillName}
                  </span>
                </button>
                <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-[10px]">
                  本地
                </Badge>
              </div>

              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {skill.importedAt && (
                  <span>
                    导入于{" "}
                    {new Date(skill.importedAt).toLocaleDateString("zh-CN")}
                  </span>
                )}
                {!skill.hasSkillMd && (
                  <Badge variant="destructive" className="px-1 py-0 text-[10px]">
                    缺少 SKILL.md
                  </Badge>
                )}
              </div>

              <div className="flex items-center gap-1.5 pt-1">
                <Button
                  variant="ghost"
                  size="xs"
                  className="gap-1 text-xs"
                  onClick={() => setDetailSkill(skill)}
                >
                  详情
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  className="gap-1 text-xs"
                  disabled={uploading === skill.skillName}
                  onClick={() => handleUploadToRemote(skill)}
                >
                  <IconCloudUpload className="size-3" />
                  {uploading === skill.skillName ? "上传中..." : "上传到远程"}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <ImportSkillDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onSuccess={loadSkills}
      />

      <LocalSkillDetailDialog
        open={!!detailSkill}
        onOpenChange={(open) => {
          if (!open) setDetailSkill(null)
        }}
        skill={detailSkill}
      />
    </div>
  )
}
