import { IconX } from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@workspace/ui/components/sheet"
import { ShiftCalendarPage } from "@/components/shift-calendar"

export function WorkbenchShiftCalendarSheet({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="flex min-h-0 flex-col gap-0 p-0 !w-[min(96vw,1440px)] !max-w-none"
      >
        <SheetHeader className="flex shrink-0 flex-row items-center justify-between border-b px-4 py-3">
          <SheetTitle className="text-sm font-medium">员工排班日历</SheetTitle>
          <Button
            variant="ghost"
            size="icon-sm"
            type="button"
            aria-label="关闭"
            onClick={() => onOpenChange(false)}
          >
            <IconX className="size-4" />
          </Button>
        </SheetHeader>
        <ShiftCalendarPage className="min-h-0 flex-1" />
      </SheetContent>
    </Sheet>
  )
}
