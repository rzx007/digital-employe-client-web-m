import * as React from "react"
import { cn } from "@workspace/ui/lib/utils"
import type { SkillListItem } from "@/api/types"
import { SkillDetailView } from "./skill-detail-view"
import { SkillsListView } from "./skills-list-view"

export function SkillsPage({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const [selectedSkill, setSelectedSkill] =
    React.useState<SkillListItem | null>(null)

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
        <SkillsListView onSelectSkill={setSelectedSkill} />
      )}
    </div>
  )
}
