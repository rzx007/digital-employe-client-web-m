import * as React from "react"
import { IconChevronRight, IconSelector } from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible"
import { Label } from "@workspace/ui/components/label"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { cn } from "@workspace/ui/lib/utils"
import type { DeptTreeNode } from "@/lib/dept-tree"
import { formatSelectedDeptSummary, isPathSelected } from "@/lib/dept-tree"

const hideScrollbar =
  "[scrollbar-width:none] [&::-webkit-scrollbar]:w-0 [&::-webkit-scrollbar]:h-0"

function DeptTreeRows({
  nodes,
  pathPrefix,
  selectedPaths,
  onTogglePath,
  disabled,
}: {
  nodes: DeptTreeNode[]
  pathPrefix: number[]
  selectedPaths: number[][]
  onTogglePath: (path: number[]) => void
  disabled?: boolean
}) {
  return (
    <ul className="space-y-0.5">
      {nodes.map((node) => {
        const path = [...pathPrefix, node.id]
        const idAttr = path.join("-")
        const hasChildren = !!node.children?.length
        const checked = isPathSelected(selectedPaths, path)

        if (!hasChildren) {
          return (
            <li key={idAttr}>
              <div className="flex items-start gap-2 py-0.5 pl-7">
                <Checkbox
                  id={`reg-dept-${idAttr}`}
                  checked={checked}
                  onCheckedChange={() => onTogglePath(path)}
                  disabled={disabled}
                  className="mt-0.5"
                />
                <Label
                  htmlFor={`reg-dept-${idAttr}`}
                  className="cursor-pointer leading-snug font-normal"
                >
                  {node.name}
                </Label>
              </div>
            </li>
          )
        }

        return (
          <li key={idAttr}>
            <Collapsible defaultOpen className="group/coll w-full">
              <div className="flex items-start gap-1">
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                    aria-expanded
                    aria-label="展开或收起子部门"
                  >
                    <IconChevronRight className="size-4 shrink-0 transition-transform duration-200 group-data-[state=open]/coll:rotate-90" />
                  </button>
                </CollapsibleTrigger>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start gap-2">
                    <Checkbox
                      id={`reg-dept-${idAttr}`}
                      checked={checked}
                      onCheckedChange={() => onTogglePath(path)}
                      disabled={disabled}
                      className="mt-0.5"
                    />
                    <Label
                      htmlFor={`reg-dept-${idAttr}`}
                      className="flex-1 cursor-pointer py-0.5 leading-snug font-normal"
                    >
                      {node.name}
                    </Label>
                  </div>
                  <CollapsibleContent>
                    <div className="mt-0.5 ml-1 border-l border-border/60 pl-2">
                      <DeptTreeRows
                        nodes={node.children!}
                        pathPrefix={path}
                        selectedPaths={selectedPaths}
                        onTogglePath={onTogglePath}
                        disabled={disabled}
                      />
                    </div>
                  </CollapsibleContent>
                </div>
              </div>
            </Collapsible>
          </li>
        )
      })}
    </ul>
  )
}

/**
 * 注册页部门：Popover 树选择器，支持展开/折叠与多选路径
 */
export function RegisterDeptTree({
  nodes,
  selectedPaths,
  onTogglePath,
  disabled,
  className,
}: {
  nodes: DeptTreeNode[]
  selectedPaths: number[][]
  onTogglePath: (path: number[]) => void
  disabled?: boolean
  className?: string
  /** @deprecated 树选择器始终在浮层内滚动，保留属性以免调用方报错 */
  expandWithoutScroll?: boolean
}) {
  const [open, setOpen] = React.useState(false)
  const summary = formatSelectedDeptSummary(nodes, selectedPaths)

  if (!nodes.length) {
    return (
      <p className="text-xs text-muted-foreground">
        暂无部门数据，请稍后重试或联系管理员
      </p>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          aria-expanded={open}
          className={cn(
            "h-auto min-h-10 w-full justify-between rounded-xs px-3 py-2 text-left font-normal",
            !summary && "text-muted-foreground",
            className
          )}
        >
          <span className="line-clamp-2 flex-1 text-sm leading-snug">
            {summary || "请选择部门（可多选）"}
          </span>
          <IconSelector className="ml-2 size-4 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="z-[100] max-h-[min(24rem,calc(100vh-8rem))] w-[min(var(--radix-popover-trigger-width),22rem)] gap-0 border border-border p-0 shadow-lg"
      >
        <ScrollArea
          className={cn("max-h-72 overflow-y-auto p-2", hideScrollbar)}
        >
          <DeptTreeRows
            nodes={nodes}
            pathPrefix={[]}
            selectedPaths={selectedPaths}
            onTogglePath={onTogglePath}
            disabled={disabled}
          />
        </ScrollArea>
      </PopoverContent>
    </Popover>
  )
}
