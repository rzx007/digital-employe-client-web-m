import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { IconSearch } from "@tabler/icons-react"

interface ShiftCalendarToolbarProps {
  year: number
  month: number
  onMonthChange: (year: number, month: number) => void
  searchQuery: string
  onSearchChange: (query: string) => void
  totalEmployees: number
  activeCount: number
}

const MONTH_NAMES = [
  "1月",
  "2月",
  "3月",
  "4月",
  "5月",
  "6月",
  "7月",
  "8月",
  "9月",
  "10月",
  "11月",
  "12月",
]

export function ShiftCalendarToolbar({
  year,
  month,
  onMonthChange,
  searchQuery,
  onSearchChange,
  totalEmployees,
  activeCount,
}: ShiftCalendarToolbarProps) {
  const handlePrev = () => {
    let m = month - 1
    let y = year
    if (m < 1) {
      m = 12
      y -= 1
    }
    onMonthChange(y, m)
  }

  const handleNext = () => {
    let m = month + 1
    let y = year
    if (m > 12) {
      m = 1
      y += 1
    }
    onMonthChange(y, m)
  }

  const handleToday = () => {
    const now = new Date()
    onMonthChange(now.getFullYear(), now.getMonth() + 1)
  }

  return (
    <div className="flex items-center gap-3 border-b px-4 py-3">
      <h2 className="text-sm font-semibold whitespace-nowrap">排班日历</h2>

      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-7"
          onClick={handlePrev}
        >
          <IconChevronLeft className="size-4" />
        </Button>
        <span className="min-w-[100px] text-center text-sm font-medium">
          {year}年 {MONTH_NAMES[month - 1]}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-7"
          onClick={handleNext}
        >
          <IconChevronRight className="size-4" />
        </Button>
      </div>

      <Button
        variant="outline"
        size="sm"
        className="h-7 text-xs"
        onClick={handleToday}
      >
        今天
      </Button>

      <div className="mx-2 h-4 w-px bg-border" />

      <div className="relative max-w-[200px] flex-1">
        <IconSearch className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="h-7 pl-7 text-xs"
          placeholder="搜索员工..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>

      <div className="ml-auto text-xs whitespace-nowrap text-muted-foreground">
        共 {totalEmployees} 名员工 · {activeCount} 名在岗
      </div>
    </div>
  )
}
