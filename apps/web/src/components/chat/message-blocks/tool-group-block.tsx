/**
 * tool-group 块的 UI 入口。
 *
 * 分类器 + mergeConsecutiveToolGroups 产出 kind === "tool-group" 的块后，由
 * chat-message-item 传入 toolAutoCollapseMap（按 tool.key 延迟收起）。
 *
 * 单工具：默认紧凑 ToolActivityLine；含 todo 列表或 diff 时用 ToolActionRow。
 * 多工具：可折叠活动流（合并后的连续工具组），组头展示 summarizeToolGroup 摘要。
 */
import { cn } from "@workspace/ui/lib/utils"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible"
import {
  IconChevronDown,
  IconCircleCheck,
  IconLoader,
  IconXboxX,
} from "@tabler/icons-react"
import type { ComponentProps } from "react"
import { useEffect, useRef, useState, memo } from "react"

import type {
  ClassifiedBlock,
  ToolGroupItem,
} from "@/lib/chat/message-classifier"
import { isRoutineTool } from "@/lib/chat/tool-label-registry"
import { ToolActionRow } from "./tool-action-row"
import { ToolActivityLine } from "./tool-activity-line"
import { getEditDiff } from "./tool-shared"

export type ToolGroupBlockProps = ComponentProps<"div"> & {
  block: Extract<ClassifiedBlock, { kind: "tool-group" }>
  toolAutoCollapseMap?: Map<string, boolean>
}

function isToolDone(tool: ToolGroupItem): boolean {
  return (
    (tool.state === "output-available" && !tool.preliminary) ||
    tool.state === "output-error"
  )
}

function isGroupDone(tools: ToolGroupItem[]): boolean {
  return tools.every(isToolDone)
}

function hasError(tools: ToolGroupItem[]): boolean {
  return tools.some((t) => t.state === "output-error")
}

/** 需要大卡 + 专用内容区（任务列表 / diff），不走紧凑活动行 */
function needsFullToolRow(tool: ToolGroupItem): boolean {
  if (tool.toolName === "edit_file") {
    return !!getEditDiff(tool.input)
  }
  return false
}

function ToolGroupBlockInner({
  block,
  className,
  toolAutoCollapseMap,
  ...props
}: ToolGroupBlockProps) {
  // 单工具块：不包一层组折叠，直接渲染一行
  if (block.tools.length === 1) {
    const tool = block.tools[0]
    if (needsFullToolRow(tool)) {
      return (
        <ToolActionRow
          className={cn("not-prose", className)}
          toolCallId={tool.toolCallId}
          summary={tool.summary}
          state={tool.state}
          resultText={tool.resultText}
          input={tool.input}
          preliminary={tool.preliminary}
          shouldAutoCollapse={toolAutoCollapseMap?.get(tool.key) ?? false}
          {...props}
        />
      )
    }
    return (
      <ToolActivityLine
        className={cn("not-prose", className)}
        toolCallId={tool.toolCallId}
        summary={tool.summary}
        state={tool.state}
        resultText={tool.resultText}
        input={tool.input}
        preliminary={tool.preliminary}
        shouldAutoCollapse={toolAutoCollapseMap?.get(tool.key) ?? false}
        {...props}
      />
    )
  }

  // 多工具块：由 mergeConsecutiveToolGroups 合并的相邻工具
  return (
    <RoutineToolActivityBlock
      block={block}
      className={className}
      toolAutoCollapseMap={toolAutoCollapseMap}
      {...props}
    />
  )
}

function RoutineToolActivityBlock({
  block,
  className,
  toolAutoCollapseMap,
  ...props
}: ToolGroupBlockProps) {
  const [isOpen, setIsOpen] = useState(false)
  const didAutoCollapseGroup = useRef(false)

  const done = isGroupDone(block.tools)
  const error = hasError(block.tools)
  const anyRunning = !done
  const lastTool = block.tools[block.tools.length - 1]
  // 整组收起与组内最后一项工具共用同一 policy 信号（见 tool-collapse-policy）
  const shouldCollapseGroup = toolAutoCollapseMap?.get(lastTool.key) ?? false

  // 回合结束或后续工具已出现时，收起组头（只触发一次，用户可再手动展开）
  useEffect(() => {
    if (!shouldCollapseGroup || didAutoCollapseGroup.current) return
    didAutoCollapseGroup.current = true
    queueMicrotask(() => setIsOpen(false))
  }, [shouldCollapseGroup])

  const allRoutine = block.tools.every((t) => isRoutineTool(t.toolName))

  return (
    <div className={cn("not-prose", className)} {...props}>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger
          className={cn(
            "group/tool-group flex w-full items-center gap-1 rounded-md px-1.5 py-1 text-xs transition-colors",
            "outline-none hover:bg-muted/50 focus-visible:ring-0",
            "text-muted-foreground/80 hover:text-muted-foreground",
            isOpen && "mb-0"
          )}
        >
          {anyRunning ? (
            <IconLoader className="size-3.5 shrink-0 animate-spin" />
          ) : error ? (
            <IconXboxX className="size-3.5 shrink-0 text-destructive/60" />
          ) : (
            <IconCircleCheck className="size-3.5 shrink-0 text-green-600/60" />
          )}
          <span className="flex min-w-0 flex-1 items-center gap-0.5 text-left">
            <span className="truncate">{block.summary}</span>
            <IconChevronDown
              className={cn(
                "size-3 shrink-0 text-muted-foreground/50 transition-transform",
                !isOpen &&
                  "hidden group-hover/tool-group:block group-focus-visible/tool-group:block",
                isOpen ? "rotate-180" : "rotate-0"
              )}
            />
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent
          className={cn(
            "overflow-hidden",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0"
          )}
        >
          <div className="ml-0.5 space-y-0 border-l border-border/40 py-0 pl-1.5">
            {block.tools.map((tool) =>
              // 常规工具用紧凑行；组内若混入非常规工具且需 diff/todos 则回退大卡
              allRoutine || !needsFullToolRow(tool) ? (
                <ToolActivityLine
                  key={tool.key}
                  toolCallId={tool.toolCallId}
                  summary={tool.summary}
                  state={tool.state}
                  resultText={tool.resultText}
                  input={tool.input}
                  preliminary={tool.preliminary}
                  shouldAutoCollapse={
                    toolAutoCollapseMap?.get(tool.key) ?? false
                  }
                />
              ) : (
                <ToolActionRow
                  key={tool.key}
                  className="w-full"
                  toolCallId={tool.toolCallId}
                  summary={tool.summary}
                  state={tool.state}
                  resultText={tool.resultText}
                  input={tool.input}
                  preliminary={tool.preliminary}
                  shouldAutoCollapse={
                    toolAutoCollapseMap?.get(tool.key) ?? false
                  }
                />
              )
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}

export const ToolGroupBlock = memo(ToolGroupBlockInner)
