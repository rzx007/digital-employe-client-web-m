import * as React from "react"
import { IconBolt, IconSparkles } from "@tabler/icons-react"

import type { OrchestratorSkill } from "@/api/orchestrator"
import type { SlashCommandItem } from "@/components/lexical-editor/slash-command-plugin"

/** 总管专属快捷指令（纯前端 prompt 模板）。最终 7 条。 */
export const CURATOR_SHORTCUTS: SlashCommandItem[] = [
  {
    id: "shortcut:progress",
    title: "查看进度",
    kind: "shortcut",
    prompt: "请汇报当前所有进行中编排计划的进度，逐项列出各子任务状态。",
    icon: <IconBolt className="h-4 w-4" />,
    description: "汇报进行中计划与各子任务状态",
    keywords: ["进度", "progress", "jindu"],
  },
  {
    id: "shortcut:deliverables",
    title: "汇总交付物",
    kind: "shortcut",
    prompt: "请汇总当前计划已产出的全部交付物，列出文件清单与所在位置。",
    icon: <IconBolt className="h-4 w-4" />,
    description: "列出已产出交付物与位置",
    keywords: ["交付物", "deliverable", "jiaofu"],
  },
  {
    id: "shortcut:retro",
    title: "团队复盘",
    kind: "shortcut",
    prompt:
      "请基于近期已完成的任务，复盘团队整体表现，指出做得好的与可改进的点。",
    icon: <IconBolt className="h-4 w-4" />,
    description: "复盘团队近期表现",
    keywords: ["复盘", "retro", "fupan"],
  },
  {
    id: "shortcut:roster",
    title: "团队与能力",
    kind: "shortcut",
    prompt: "请列出当前团队成员及各自能力画像，帮我判断谁适合接下来的任务。",
    icon: <IconBolt className="h-4 w-4" />,
    description: "查看团队名册与能力画像",
    keywords: ["名册", "团队", "roster", "mingce"],
  },
  {
    id: "shortcut:qa",
    title: "质检返工",
    kind: "shortcut",
    prompt: "请对最近完成的子任务交付物做一次质检，对不达标的安排返工。",
    icon: <IconBolt className="h-4 w-4" />,
    description: "质检交付物并安排返工",
    keywords: ["质检", "返工", "qa", "zhijian"],
  },
  {
    id: "shortcut:gap",
    title: "缺口诊断",
    kind: "shortcut",
    prompt:
      "评估接下来的任务是否缺人或缺技能，需要就建议招人或去技能市场装技能。",
    icon: <IconBolt className="h-4 w-4" />,
    description: "诊断人手/技能缺口并给建议",
    keywords: ["缺口", "招人", "gap", "quekou"],
  },
  {
    id: "shortcut:cancel",
    title: "取消计划",
    kind: "shortcut",
    prompt: "请取消当前进行中的编排计划。",
    icon: <IconBolt className="h-4 w-4" />,
    description: "取消进行中的编排计划",
    keywords: ["取消", "cancel", "quxiao"],
  },
]

/** 合并：快捷指令在前、总管技能在后（顺序契约见 slash-command-plugin 分组渲染）。 */
export function buildCuratorSlashCommands(
  skills: OrchestratorSkill[]
): SlashCommandItem[] {
  const skillItems: SlashCommandItem[] = skills.map((s) => ({
    id: `skill:${s.name}`,
    title: s.name,
    kind: "skill",
    icon: <IconSparkles className="h-4 w-4" />,
    description: s.description ?? "",
    keywords: [s.name.toLowerCase()],
  }))
  return [...CURATOR_SHORTCUTS, ...skillItems]
}

/** 按命令类型决定外发正文与 skill 参数。 */
export function resolveCuratorSend(
  item: SlashCommandItem | undefined,
  baseText: string
): { text: string; skill: string } {
  if (item?.kind === "shortcut") {
    return {
      text: [item.prompt, baseText].filter(Boolean).join("\n"),
      skill: "",
    }
  }
  if (item) {
    // 技能：沿用后端 skill 注入链路
    return { text: baseText, skill: item.title }
  }
  return { text: baseText, skill: "" }
}
