import * as React from "react"

import { IconCheck } from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@workspace/ui/components/command"
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
  const [tab, setTab] = React.useState<"mcp" | "skill">("mcp")

  React.useEffect(() => {
    if (open) {
      setDraftMcpIds(selectedMcpIds)
      setDraftSkillIds(selectedSkillIds)
      setTab("mcp")
    }
  }, [open, selectedMcpIds, selectedSkillIds])

  const toggleMcp = (id: number) => {
    setDraftMcpIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    )
  }

  const toggleSkill = (id: number) => {
    setDraftSkillIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    )
  }

  const handleConfirm = () => {
    onConfirm(draftMcpIds, draftSkillIds)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[70vh] max-w-lg flex-col gap-0 p-0">
        <DialogHeader className="px-5 pt-5 pb-3">
          <DialogTitle>添加能力</DialogTitle>
          <DialogDescription>选择 MCP 工具和技能</DialogDescription>
        </DialogHeader>
        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as "mcp" | "skill")}
          className="flex flex-1 flex-col overflow-hidden"
        >
          <TabsList className="mx-5 grid h-9 grid-cols-2 rounded-none rounded-t-lg border-b">
            <TabsTrigger value="mcp" className="rounded-none">
              MCP 工具
            </TabsTrigger>
            <TabsTrigger value="skill" className="rounded-none">
              技能
            </TabsTrigger>
          </TabsList>
          <TabsContent value="mcp" className="mt-0 min-h-0 flex-1 overflow-hidden">
            <Command className="border-none">
              <CommandInput placeholder="搜索 MCP 工具..." />
              <CommandList>
                <CommandEmpty>没有找到匹配的工具</CommandEmpty>
                <CommandGroup>
                  {allMcpList.map((item) => {
                    const checked = draftMcpIds.includes(item.id)
                    return (
                      <CommandItem
                        key={item.id}
                        value={`${item.capability_name}-${item.capability_desc}`}
                        onSelect={() => toggleMcp(item.id)}
                      >
                        <div className="flex w-full items-center gap-3 py-1">
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium">
                              {item.capability_name}
                            </div>
                            <div className="truncate text-xs text-muted-foreground">
                              {item.capability_desc}
                            </div>
                          </div>
                          <IconCheck
                            className={cn(
                              "size-4 shrink-0",
                              checked ? "opacity-100" : "opacity-0"
                            )}
                          />
                        </div>
                      </CommandItem>
                    )
                  })}
                </CommandGroup>
              </CommandList>
            </Command>
          </TabsContent>
          <TabsContent value="skill" className="mt-0 min-h-0 flex-1 overflow-hidden">
            <Command className="border-none">
              <CommandInput placeholder="搜索技能..." />
              <CommandList>
                <CommandEmpty>没有找到匹配的技能</CommandEmpty>
                <CommandGroup>
                  {allSkillList.map((item) => {
                    const checked = draftSkillIds.includes(item.id)
                    return (
                      <CommandItem
                        key={item.id}
                        value={`${item.skillName}-${item.description}`}
                        onSelect={() => toggleSkill(item.id)}
                      >
                        <div className="flex w-full items-center gap-3 py-1">
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium">
                              {item.displayNameZh || item.skillName}
                            </div>
                            <div className="truncate text-xs text-muted-foreground">
                              {item.description}
                            </div>
                          </div>
                          <IconCheck
                            className={cn(
                              "size-4 shrink-0",
                              checked ? "opacity-100" : "opacity-0"
                            )}
                          />
                        </div>
                      </CommandItem>
                    )
                  })}
                </CommandGroup>
              </CommandList>
            </Command>
          </TabsContent>
        </Tabs>
        <div className="flex justify-end gap-2 border-t px-5 py-3">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleConfirm}>确认</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
