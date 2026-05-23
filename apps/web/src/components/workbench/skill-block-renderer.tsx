import { cn } from "@workspace/ui/lib/utils"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import type { BlockType } from "@/types/workbench"

interface SkillBlockRendererProps {
  blockType: BlockType
  title: string
  skillId: number | null
  className?: string
}

function LarkBitableBlock() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 py-8 text-center">
      <svg
        className="size-12 text-[#23C9FF]"
        viewBox="0 0 24 24"
        fill="currentColor"
      >
        <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
      </svg>
      <div className="text-sm font-medium">飞书多维表格</div>
      <div className="text-xs text-muted-foreground">正在连接数据...</div>
    </div>
  )
}

function DataStatsBlock() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 py-8 text-center">
      <svg
        className="size-12 text-emerald-500"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path d="M18 20V10M12 20V4M6 20v-6" />
      </svg>
      <div className="text-sm font-medium">数据统计</div>
      <div className="text-xs text-muted-foreground">正在加载统计数据...</div>
    </div>
  )
}

function ScheduleViewBlock() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 py-8 text-center">
      <svg
        className="size-12 text-orange-500"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <path d="M16 2v4M8 2v4M3 10h18" />
      </svg>
      <div className="text-sm font-medium">排班视图</div>
      <div className="text-xs text-muted-foreground">正在获取排班信息...</div>
    </div>
  )
}

function CustomBlock({ title }: { title: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 py-8 text-center">
      <svg
        className="size-12 text-muted-foreground/50"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M9 9h6M9 15h6M9 12h6" />
      </svg>
      <div className="text-sm font-medium">{title}</div>
      <div className="text-xs text-muted-foreground">暂无数据</div>
    </div>
  )
}

export function SkillBlockRenderer({
  blockType,
  title,
  className,
}: SkillBlockRendererProps) {
  return (
    <Card className={cn("h-full", className)}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {blockType === "lark-bitable" && <LarkBitableBlock />}
        {blockType === "data-stats" && <DataStatsBlock />}
        {blockType === "schedule-view" && <ScheduleViewBlock />}
        {blockType === "custom" && <CustomBlock title={title} />}
      </CardContent>
    </Card>
  )
}
