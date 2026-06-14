import { describe, expect, it } from "vitest"

import { getResourceBucket, toBucketRelativeSegments } from "./paths"

describe("getResourceBucket", () => {
  it("prioritises skills-draft over artifacts when both segments present", () => {
    const p =
      "C:/Users/x/.digital-employee/conversations/employee-3/artifacts/conv-638/skills-draft/frontend-demo/SKILL.md"
    expect(getResourceBucket(p)).toBe("skills_draft")
  })
})

describe("toBucketRelativeSegments", () => {
  it("anchors on skills-draft even when an artifacts segment precedes it", () => {
    // 真实草稿路径同时含 artifacts/ 和 skills-draft/；必须按所属桶 skills-draft 取相对段，
    // 否则 rel[0] 会错成 conv-638（导致 save-draft 接口拿到错误 skillName → 404）。
    const p =
      "C:/Users/x/.digital-employee/conversations/employee-3/artifacts/conv-638/skills-draft/frontend-demo/SKILL.md"
    const rel = toBucketRelativeSegments(p)
    expect(rel[0]).toBe("frontend-demo")
    expect(rel).toEqual(["frontend-demo", "SKILL.md"])
  })

  it("handles plain artifacts paths", () => {
    const p = "/root/owner/artifacts/conv-1/report/summary.md"
    expect(toBucketRelativeSegments(p)).toEqual([
      "conv-1",
      "report",
      "summary.md",
    ])
  })

  it("handles uploads paths", () => {
    const p = "/root/owner/artifacts/conv-1/uploads/a.png"
    // bucket = uploads (uploads 优先级高于 artifacts)，应锚定 uploads
    expect(toBucketRelativeSegments(p)).toEqual(["a.png"])
  })

  it("falls back to basename when no bucket segment present", () => {
    expect(toBucketRelativeSegments("/tmp/foo/bar.txt")).toEqual(["bar.txt"])
  })
})
