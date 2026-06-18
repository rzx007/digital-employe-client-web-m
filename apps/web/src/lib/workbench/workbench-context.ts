import { GLOBAL_WORKBENCH_ID, loadWorkbenchConfig } from "./workbench-config"

/** 生成「工作台现状」紧凑文本，供注入总管对话。无看板时返回明确空串提示。 */
export function buildWorkbenchSnapshot(): string {
  const cfg = loadWorkbenchConfig(GLOBAL_WORKBENCH_ID)
  const blocks = cfg?.blocks ?? []
  if (blocks.length === 0) return "当前没有看板。"
  return blocks
    .map(
      (b, i) =>
        `${i + 1}. ${b.title}（${b.gridSpan.w}×${b.gridSpan.h}@${b.gridPos.x},${b.gridPos.y}${b.enabled ? "" : "·已隐藏"}）`
    )
    .join("；")
}
