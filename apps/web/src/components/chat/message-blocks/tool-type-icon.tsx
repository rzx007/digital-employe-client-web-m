import { IconCode } from "@tabler/icons-react"
import type { ComponentProps } from "react"
import { TOOL_ICON_MAP } from "./tool-shared"

export type ToolTypeIconProps = {
  toolName: string
} & Pick<ComponentProps<typeof IconCode>, "className">

/** 按工具名渲染行首图标（须在模块级组件内查表，避免在父组件 render 中动态绑定组件类型） */
export function ToolTypeIcon({ toolName, className }: ToolTypeIconProps) {
  const Icon = TOOL_ICON_MAP[toolName] ?? IconCode
  return <Icon className={className} />
}
