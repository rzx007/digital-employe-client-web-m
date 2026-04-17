import * as React from "react"

import { IconCheck, IconPlug, IconSearch } from "@tabler/icons-react"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs"
import { Input } from "@workspace/ui/components/input"
import type { McpListItem, SkillListItem } from "@/api/types"
import { cn } from "@workspace/ui/lib/utils"

interface CapabilityPickerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  allMcpList: McpListItem[]
  allSkillList: SkillListItem[]
  selectedMcpIds: number[]
  selectedSkillIds: number[]
  onConfirm: (mcpIds: number[], skillIds: number[]) => void
}

export function CapabilityPickerDialog({
  open,
  onOpenChange,
  allMcpList,
  allSkillList,
  selectedMcpIds,
  selectedSkillIds,
  onConfirm,
}: CapabilityPickerDialogProps) {
  const [draftMcpIds, setDraftMcpIds] = React.useState<number[]>(selectedMcpIds)
  const [draftSkillIds, setDraftSkillIds] =
    React.useState<number[]>(selectedSkillIds)
  const [tab, setTab] = React.useState<"mcp" | "skill">("skill")

  const [searchQuery, setSearchQuery] = React.useState("")

  React.useEffect(() => {
    if (open) {
      setDraftMcpIds(selectedMcpIds)
      setDraftSkillIds(selectedSkillIds)
      setSearchQuery("")
    }
  }, [open, selectedMcpIds, selectedSkillIds])

  const toggleSkill = (id: number) => {
    setDraftSkillIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    )
  }

  const toggleMcp = (id: number) => {
    setDraftMcpIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    )
  }

  const handleConfirm = () => {
    onConfirm(draftMcpIds, draftSkillIds)
    onOpenChange(false)
  }

  const filteredSkills = React.useMemo(() => {
    if (!searchQuery.trim()) return allSkillList
    const q = searchQuery.toLowerCase()
    return allSkillList.filter(
      (item) =>
        item.skillName.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        (item.displayNameZh && item.displayNameZh.toLowerCase().includes(q))
    )
  }, [allSkillList, searchQuery])

  const filteredMcps = React.useMemo(() => {
    if (!searchQuery.trim()) return allMcpList
    const q = searchQuery.toLowerCase()
    return allMcpList.filter(
      (item) =>
        item.capability_name.toLowerCase().includes(q) ||
        item.capability_desc.toLowerCase().includes(q) ||
        item.mcp_server_name.toLowerCase().includes(q) ||
        item.mcp_tool_name.toLowerCase().includes(q)
    )
  }, [allMcpList, searchQuery])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[80vh] w-full max-w-2xl flex-col gap-0 p-0 sm:max-w-2xl">
        <DialogHeader className="px-6 pt-6 pb-4">
          <DialogTitle>添加技能</DialogTitle>
          <DialogDescription>选择需要配置的技能</DialogDescription>
        </DialogHeader>
        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as "mcp" | "skill")}
          className="flex flex-1 flex-col overflow-hidden"
        >
          <TabsList className="mx-5 grid h-9 grid-cols-2 rounded-none rounded-t-lg border-b">
            <TabsTrigger value="skill" className="rounded-none">
              技能
            </TabsTrigger>
            <TabsTrigger value="mcp" className="rounded-none">
              MCP 工具
            </TabsTrigger>
          </TabsList>
          <TabsContent
            value="skill"
            className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden"
          >
            <div className="relative shrink-0 px-6 pb-3">
              <IconSearch className="pointer-events-none absolute top-2/5 left-[2.25rem] size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="搜索技能..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-4">
              {filteredSkills.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <IconSearch className="size-8 stroke-1" />
                  <p className="mt-2 text-sm">没有找到匹配的技能</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {filteredSkills.map((item) => {
                    const checked = draftSkillIds.includes(item.id)
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className={cn(
                          "relative flex flex-col gap-1 rounded-lg border p-3 text-left transition-colors",
                          checked
                            ? "border-primary bg-primary/5"
                            : "border-border hover:border-primary/30"
                        )}
                        onClick={() => toggleSkill(item.id)}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-sm leading-snug font-medium">
                            {item.displayNameZh || item.skillName}
                          </span>
                          <IconCheck
                            className={cn(
                              "size-4 shrink-0 text-primary",
                              checked ? "opacity-100" : "opacity-0"
                            )}
                          />
                        </div>
                        <span className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                          {item.description}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </TabsContent>
          <TabsContent
            value="mcp"
            className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden"
          >
            <div className="relative shrink-0 px-6 pb-3">
              <IconSearch className="pointer-events-none absolute top-2/5 left-[2.25rem] size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="搜索 MCP 工具..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-4">
              {filteredMcps.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <IconSearch className="size-8 stroke-1" />
                  <p className="mt-2 text-sm">没有找到匹配的 MCP 工具</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {filteredMcps.map((item) => {
                    const checked = draftMcpIds.includes(item.id)
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className={cn(
                          "relative flex flex-col gap-1 rounded-lg border p-3 text-left transition-colors",
                          checked
                            ? "border-primary bg-primary/5"
                            : "border-border hover:border-primary/30"
                        )}
                        onClick={() => toggleMcp(item.id)}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <IconPlug className="size-3.5 shrink-0 text-muted-foreground" />
                            <span className="text-sm leading-snug font-medium">
                              {item.capability_name}
                            </span>
                          </div>
                          <IconCheck
                            className={cn(
                              "size-4 shrink-0 text-primary",
                              checked ? "opacity-100" : "opacity-0"
                            )}
                          />
                        </div>
                        <span className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                          {item.capability_desc}
                        </span>
                        <div className="flex items-center gap-1">
                          <Badge
                            variant="secondary"
                            className="px-1 py-0 text-[10px] font-normal"
                          >
                            {item.mcp_server_name}
                          </Badge>
                          <span className="text-[10px] text-muted-foreground">
                            /
                          </span>
                          <Badge
                            variant="outline"
                            className="px-1 py-0 text-[10px] font-normal"
                          >
                            {item.mcp_tool_name}
                          </Badge>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>

        <div className="flex justify-end gap-2 border-t px-6 py-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleConfirm}>确认</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
