import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { Button } from "@workspace/ui/components/button"
import { IconRocket, IconArrowRight } from "@tabler/icons-react"
import { useOnboardingStore } from "@/stores/onboarding-store"

export function WelcomeDialog() {
  const showWelcomeDialog = useOnboardingStore((s) => s.showWelcomeDialog)
  const startTour = useOnboardingStore((s) => s.startTour)
  const closeWelcomeDialog = useOnboardingStore((s) => s.closeWelcomeDialog)

  return (
    <Dialog
      open={showWelcomeDialog}
      onOpenChange={(open) => {
        if (!open) closeWelcomeDialog()
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mx-auto mb-2 flex size-14 items-center justify-center rounded-full bg-primary/10">
            <IconRocket className="size-7 text-primary" />
          </div>
          <DialogTitle className="text-center text-xl">
            欢迎使用数字员工平台
          </DialogTitle>
          <DialogDescription className="text-center text-sm">
            通过 AI 数字员工，让重复性工作自动化完成。
            <br />
            跟随快速引导，了解核心操作流程。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 rounded-lg border bg-muted/50 px-4 py-3">
          <p className="text-xs font-medium text-muted-foreground">
            引导将涵盖以下操作：
          </p>
          <ul className="space-y-1.5 text-sm">
            <li className="flex items-center gap-2">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                1
              </span>
              招聘数字员工
            </li>
            <li className="flex items-center gap-2">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                2
              </span>
              查看联系人并开始对话
            </li>
            <li className="flex items-center gap-2">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                3
              </span>
              编辑员工与下发任务
            </li>
            <li className="flex items-center gap-2">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                4
              </span>
              查看任务通知
            </li>
          </ul>
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button className="w-full gap-1.5" onClick={startTour}>
            <IconArrowRight className="size-4" />
            开始引导
          </Button>
          <Button
            variant="ghost"
            className="w-full text-muted-foreground"
            onClick={closeWelcomeDialog}
          >
            跳过，稍后再说
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
