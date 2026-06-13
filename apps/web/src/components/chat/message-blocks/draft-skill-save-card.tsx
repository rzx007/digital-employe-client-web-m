import * as React from "react"
import { IconBulb, IconCheck, IconLoader2 } from "@tabler/icons-react"
import { toast } from "sonner"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { checkLocalSkillNameExists, saveDraftSkill } from "@/api/skill"
import { useChatStore } from "@/stores/chat-store"

export function DraftSkillSaveCard({
  skillName,
  className,
}: {
  skillName: string
  skillPath: string
  className?: string
}) {
  const conversationId = useChatStore((s) => s.selectedConversationId)
  // 员工 id 不是独立 store 字段：会话归属于当前选中联系人，员工类型联系人
  // 的真实员工主键在 contact.employee.id（见 contact-utils 的 getContactId）。
  const employeeId = useChatStore(
    (s) => s.getSelectedContact()?.employee?.id ?? null
  )
  const [saved, setSaved] = React.useState(false)
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    checkLocalSkillNameExists(skillName)
      .then((exists) => {
        if (!cancelled && exists) setSaved(true)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [skillName])

  const handleSave = async () => {
    if (conversationId == null || employeeId == null) {
      toast.error("无法确定当前会话或员工")
      return
    }
    setSaving(true)
    try {
      const res = await saveDraftSkill({
        conversationId: Number(conversationId),
        skillName,
        employeeId: Number(employeeId),
      })
      setSaved(true)
      toast.success(
        res.attachedToEmployee
          ? `技能「${res.skillName}」已保存，当前员工已永久拥有`
          : `技能「${res.skillName}」已入技能库，但挂到当前员工失败，可在员工配置手动添加`
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : "保存失败，请稍后重试"
      toast.error(msg)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className={cn(
        "not-prose flex w-full items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2.5",
        className
      )}
    >
      <IconBulb className="size-5 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">
          员工新学会了技能：{skillName}
        </p>
        <p className="text-xs text-muted-foreground">
          保存后该技能将进入技能库，当前员工永久拥有，其他员工招聘时也可选用
        </p>
      </div>
      <Button
        size="sm"
        disabled={saving || saved}
        onClick={handleSave}
        className="shrink-0"
      >
        {saving ? (
          <span className="flex items-center gap-1.5">
            <IconLoader2 className="size-3.5 animate-spin" />
            保存中
          </span>
        ) : saved ? (
          <span className="flex items-center gap-1.5">
            <IconCheck className="size-3.5" />
            已加入技能库
          </span>
        ) : (
          "保存到我的技能库"
        )}
      </Button>
    </div>
  )
}
