import * as React from "react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog"
import { Checkbox } from "@workspace/ui/components/checkbox"
import { Label } from "@workspace/ui/components/label"

import { setBrowserCloseConfirmDismissed } from "@/lib/browser/close-confirm"

interface BrowserCloseConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}

export function BrowserCloseConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
}: BrowserCloseConfirmDialogProps) {
  const [skipNextTime, setSkipNextTime] = React.useState(false)

  const handleOpenChange = (next: boolean) => {
    if (!next) setSkipNextTime(false)
    onOpenChange(next)
  }

  const handleConfirm = () => {
    if (skipNextTime) {
      setBrowserCloseConfirmDismissed(true)
    }
    onConfirm()
    onOpenChange(false)
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>关闭浏览器？</AlertDialogTitle>
          <AlertDialogDescription>
            将关闭并销毁当前内嵌浏览器实例，未保存的页面状态会丢失。最小化浏览器请使用标题栏的减号按钮。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex items-center gap-2 py-1">
          <Checkbox
            id="browser-close-skip-confirm"
            checked={skipNextTime}
            onCheckedChange={(checked) =>
              setSkipNextTime(checked === true)
            }
          />
          <Label
            htmlFor="browser-close-skip-confirm"
            className="cursor-pointer text-sm font-normal text-muted-foreground"
          >
            不再提醒
          </Label>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={handleConfirm}>
            关闭浏览器
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
