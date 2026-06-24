import type { UIMessage } from "ai"
import { describe, expect, it } from "vitest"
import {
  classifyMessageParts,
  type ClassifiedBlock,
} from "./message-classifier"

/**
 * 构造一个最小的 write_file 工具 part（output-available），其 file_path 落在给定路径。
 * 分类器据 getFileChangesFromUIMessage 的结果产出 file-changes / draft-skill-save 块。
 */
function writeFilePart(filePath: string, toolCallId: string) {
  return {
    type: "tool-write_file",
    toolCallId,
    state: "output-available",
    input: { file_path: filePath, content: "x" },
    output: "ok",
  } as unknown as UIMessage["parts"][number]
}

function assistantMessage(id: string, parts: UIMessage["parts"]): UIMessage {
  return { id, role: "assistant", parts } as unknown as UIMessage
}

function findBlocks(blocks: ClassifiedBlock[], kind: ClassifiedBlock["kind"]) {
  return blocks.filter((b) => b.kind === kind)
}

describe("classifyMessageParts — 草稿技能", () => {
  it("写入 skills-draft/<name>/SKILL.md 时产出 draft-skill-save 块", () => {
    const message = assistantMessage("m1", [
      writeFilePart("/home/user/skills-draft/news-digest/SKILL.md", "t1"),
    ])

    const blocks = classifyMessageParts(message, { includeFileChanges: true })

    const draftBlocks = findBlocks(blocks, "draft-skill-save")
    expect(draftBlocks).toHaveLength(1)
    const draft = draftBlocks[0] as Extract<
      ClassifiedBlock,
      { kind: "draft-skill-save" }
    >
    expect(draft.skillName).toBe("news-digest")
    expect(draft.skillPath).toBe("/home/user/skills-draft/news-digest")
  })

  it("同时含普通产物时，file-changes 面板剔除 skill-folder（去重）", () => {
    const message = assistantMessage("m2", [
      writeFilePart("/home/user/skills-draft/news-digest/SKILL.md", "t1"),
      writeFilePart("/home/user/artifacts/report.md", "t2"),
    ])

    const blocks = classifyMessageParts(message, { includeFileChanges: true })

    // draft-skill-save 仍由草稿技能承载
    expect(findBlocks(blocks, "draft-skill-save")).toHaveLength(1)

    // file-changes 面板只剩普通产物，不含 skill-folder
    const fileChangeBlocks = findBlocks(blocks, "file-changes")
    expect(fileChangeBlocks).toHaveLength(1)
    const fileChanges = fileChangeBlocks[0] as Extract<
      ClassifiedBlock,
      { kind: "file-changes" }
    >
    expect(fileChanges.files).toHaveLength(1)
    expect(fileChanges.files[0].kind).toBe("file")
    expect(fileChanges.files.some((f) => f.kind === "skill-folder")).toBe(false)
  })

  it("仅普通产物时不产出 draft-skill-save 块", () => {
    const message = assistantMessage("m3", [
      writeFilePart("/home/user/artifacts/report.md", "t1"),
    ])

    const blocks = classifyMessageParts(message, { includeFileChanges: true })

    expect(findBlocks(blocks, "draft-skill-save")).toHaveLength(0)
    expect(findBlocks(blocks, "file-changes")).toHaveLength(1)
  })

  it("skills-draft 下只有 .py 脚本（无 SKILL.md）不产出 draft-skill-save 块", () => {
    // agent 把临时脚本写进 skills-draft，但没有 SKILL.md → 不是真正的技能，不该弹卡
    const message = assistantMessage("m4", [
      writeFilePart("/home/user/skills-draft/fetch-weibo/fetch-weibo-api.py", "t1"),
      writeFilePart("/home/user/skills-draft/fetch-weibo/test-apis.py", "t2"),
    ])

    const blocks = classifyMessageParts(message, { includeFileChanges: true })

    expect(findBlocks(blocks, "draft-skill-save")).toHaveLength(0)
  })

  it("skills-draft 下有 SKILL.md + 脚本时，仍只产出一张 draft-skill-save 卡", () => {
    const message = assistantMessage("m5", [
      writeFilePart("/home/user/skills-draft/news-digest/SKILL.md", "t1"),
      writeFilePart("/home/user/skills-draft/news-digest/fetch.py", "t2"),
    ])

    const blocks = classifyMessageParts(message, { includeFileChanges: true })

    const draftBlocks = findBlocks(blocks, "draft-skill-save")
    expect(draftBlocks).toHaveLength(1)
    const draft = draftBlocks[0] as Extract<
      ClassifiedBlock,
      { kind: "draft-skill-save" }
    >
    expect(draft.skillName).toBe("news-digest")
  })
})
