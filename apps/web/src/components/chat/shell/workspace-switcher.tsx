import * as React from "react"
import {
  IconChevronDown,
  IconFolder,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import { Button } from "@workspace/ui/components/button"
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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { Input } from "@workspace/ui/components/input"
import { cn } from "@workspace/ui/lib/utils"

import {
  createWorkspace,
  deleteWorkspace,
  listWorkspaces,
  type WorkspaceData,
} from "@/api/workspace"
import { restoreChatAfterWorkspaceSwitch } from "@/lib/chat/restore-chat-after-workspace-switch"
import { withElectronApi } from "@/lib/electron/host"
import { useAuthStore } from "@/stores/auth-store"

/** 工作空间（项目）切换器：列出当前用户项目、切换、新建空项目、删除非当前项目。 */
export function WorkspaceSwitcher({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const queryClient = useQueryClient()
  const activeWorkspaceId = useAuthStore((s) => s.workspaceId)

  const [menuOpen, setMenuOpen] = React.useState(false)
  const [createOpen, setCreateOpen] = React.useState(false)
  const [newName, setNewName] = React.useState("")
  const [newRootPath, setNewRootPath] = React.useState<string | null>(null)
  const [pendingDelete, setPendingDelete] =
    React.useState<WorkspaceData | null>(null)

  const { data: workspaces = [] } = useQuery({
    queryKey: ["workspaces", "list"],
    queryFn: ({ signal }) => listWorkspaces({ signal }),
  })

  const activeWorkspace = React.useMemo(
    () => workspaces.find((w) => w.id === activeWorkspaceId),
    [workspaces, activeWorkspaceId]
  )

  const switchTo = React.useCallback(
    (id: number) => {
      if (id === activeWorkspaceId) return
      useAuthStore.getState().setWorkspaceId(id)
      void restoreChatAfterWorkspaceSwitch(queryClient, id)
    },
    [activeWorkspaceId, queryClient]
  )

  const createMutation = useMutation({
    mutationFn: (vars: { name?: string; rootPath?: string }) =>
      createWorkspace(vars.name, vars.rootPath),
    onSuccess: (workspace) => {
      void queryClient.invalidateQueries({ queryKey: ["workspaces", "list"] })
      setCreateOpen(false)
      setNewName("")
      setNewRootPath(null)
      switchTo(workspace.id)
      toast.success("项目已创建")
    },
    onError: () => {
      toast.error("创建项目失败，请稍后重试")
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteWorkspace(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["workspaces", "list"] })
      setPendingDelete(null)
      toast.success("项目已删除")
    },
    onError: () => {
      toast.error("删除项目失败，请稍后重试")
    },
  })

  const handleCreate = () => {
    const name = newName.trim()
    createMutation.mutate({
      name: name || undefined,
      rootPath: newRootPath || undefined,
    })
  }

  const handlePickFolder = () => {
    void withElectronApi(async (api) => {
      const path = await api.selectDirectory()
      if (path) setNewRootPath(path)
    })
  }

  return (
    <div className={cn("w-full", className)} {...props}>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className="h-auto w-full justify-between gap-2 px-2 py-1.5"
          >
            <span className="flex min-w-0 items-center gap-2">
              <IconFolder className="size-4 shrink-0 text-muted-foreground" />
              <span className="truncate text-sm font-medium">
                {activeWorkspace?.name ?? "选择项目"}
              </span>
            </span>
            <IconChevronDown className="size-4 shrink-0 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel>项目</DropdownMenuLabel>
          {workspaces.map((w) => (
            <DropdownMenuItem
              key={w.id}
              className="flex items-center justify-between gap-2"
              onSelect={(e) => {
                e.preventDefault()
                switchTo(w.id)
                setMenuOpen(false)
              }}
            >
              <span className="flex min-w-0 items-center gap-2">
                <IconFolder
                  className={cn(
                    "size-4 shrink-0",
                    w.id === activeWorkspaceId
                      ? "text-primary"
                      : "text-muted-foreground"
                  )}
                />
                <span className="truncate">{w.name}</span>
              </span>
              {w.id !== activeWorkspaceId && (
                <button
                  type="button"
                  className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-destructive"
                  title="删除项目"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    setPendingDelete(w)
                    setMenuOpen(false)
                  }}
                >
                  <IconTrash className="size-3.5" />
                </button>
              )}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault()
              setMenuOpen(false)
              setCreateOpen(true)
            }}
          >
            <IconPlus className="size-4" />
            新建项目
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open)
          if (!open) setNewRootPath(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建项目</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            placeholder="项目名称（可留空使用默认名）"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreate()
            }}
          />
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handlePickFolder}
                disabled={createMutation.isPending}
              >
                <IconFolder className="size-4" />
                选择文件夹（可选）
              </Button>
              {newRootPath && (
                <span
                  className="min-w-0 flex-1 truncate text-xs text-muted-foreground"
                  title={newRootPath}
                >
                  {newRootPath}
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              选本地文件夹作工作空间，产物直接存入；支持已有项目目录
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCreateOpen(false)}
              disabled={createMutation.isPending}
            >
              取消
            </Button>
            <Button onClick={handleCreate} disabled={createMutation.isPending}>
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={pendingDelete != null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除项目</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除项目「{pendingDelete?.name}」吗？此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                if (pendingDelete) deleteMutation.mutate(pendingDelete.id)
              }}
              disabled={deleteMutation.isPending}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
