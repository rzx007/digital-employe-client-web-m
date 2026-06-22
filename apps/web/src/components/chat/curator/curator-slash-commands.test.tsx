import { describe, expect, it } from "vitest"
import {
  CURATOR_SHORTCUTS,
  buildCuratorSlashCommands,
  resolveCuratorSend,
} from "./curator-slash-commands"

describe("buildCuratorSlashCommands", () => {
  it("快捷指令在前、技能在后", () => {
    const out = buildCuratorSlashCommands([
      { name: "find-skills", description: "找技能" },
    ])
    const head = out.slice(0, CURATOR_SHORTCUTS.length)
    expect(head.every((c) => c.kind === "shortcut")).toBe(true)
    expect(out[out.length - 1]).toMatchObject({
      kind: "skill",
      title: "find-skills",
    })
  })

  it("技能为空时只剩快捷指令", () => {
    expect(buildCuratorSlashCommands([])).toHaveLength(CURATOR_SHORTCUTS.length)
  })
})

describe("resolveCuratorSend", () => {
  it("快捷指令：模板进正文、skill 为空", () => {
    const sc = CURATOR_SHORTCUTS[0]
    expect(resolveCuratorSend(sc, "")).toEqual({ text: sc.prompt, skill: "" })
    expect(resolveCuratorSend(sc, "补充")).toEqual({
      text: `${sc.prompt}\n补充`,
      skill: "",
    })
  })

  it("技能：skill 取 title、正文不变", () => {
    const item = buildCuratorSlashCommands([
      { name: "find-skills", description: "" },
    ]).find((c) => c.kind === "skill")!
    expect(resolveCuratorSend(item, "帮我找")).toEqual({
      text: "帮我找",
      skill: "find-skills",
    })
  })

  it("无命令：原样透传", () => {
    expect(resolveCuratorSend(undefined, "你好")).toEqual({
      text: "你好",
      skill: "",
    })
  })
})
