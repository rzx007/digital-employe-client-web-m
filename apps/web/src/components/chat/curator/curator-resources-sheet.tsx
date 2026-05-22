import { ArtifactPanel } from "@/components/artifact"
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@workspace/ui/components/sheet"

export function CuratorResourcesSheet({
  conversationId,
  open,
  onOpenChange,
}: {
  conversationId: string | number | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  if (conversationId == null) return null

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="flex w-[min(520px,92vw)] max-w-[92vw] flex-col gap-0 p-0 sm:max-w-[min(520px,92vw)]"
      >
        <SheetTitle className="sr-only">资源管理器</SheetTitle>
        {open && (
          <ArtifactPanel
            presentation="embedded"
            conversationId={conversationId}
            isOpen
            onClose={() => onOpenChange(false)}
            className="h-full"
          />
        )}
      </SheetContent>
    </Sheet>
  )
}
