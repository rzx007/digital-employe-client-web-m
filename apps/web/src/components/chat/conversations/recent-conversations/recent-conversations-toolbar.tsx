import { useNavigate } from "@tanstack/react-router"
import {
  IconCirclePlus,
  IconSearch,
  IconUserPlus,
  IconUsers,
} from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { Input } from "@workspace/ui/components/input"

interface RecentConversationsToolbarProps {
  searchQuery: string
  onSearchChange: (value: string) => void
  onOpenCreateGroup: () => void
}

export function RecentConversationsToolbar({
  searchQuery,
  onSearchChange,
  onOpenCreateGroup,
}: RecentConversationsToolbarProps) {
  const navigate = useNavigate()

  return (
    <div className="flex items-center gap-1.5 border-b px-3 py-4">
      <div className="relative flex-1">
        <IconSearch className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="h-7 border-none bg-background pl-7 text-xs"
          placeholder="搜索会话..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className="h-7 w-7 shrink-0"
            data-tour-id="add-button"
          >
            <IconCirclePlus className="size-5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onClick={async () => {
              if (window.electronApi?.openRecruitment) {
                await window.electronApi.openRecruitment()
              } else {
                navigate({ to: "/recruitment" })
              }
            }}
          >
            <IconUserPlus className="size-4" />
            招聘员工
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onOpenCreateGroup}>
            <IconUsers className="size-5" />
            添加群聊
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
