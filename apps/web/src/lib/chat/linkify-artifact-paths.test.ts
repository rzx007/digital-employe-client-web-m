import { describe, expect, it } from "vitest"
import { basenameOfPath, linkifyArtifactPaths } from "./linkify-artifact-paths"

describe("linkifyArtifactPaths", () => {
  it("把全角括号里的产物路径包装成链接，链接文字取文件名", () => {
    const text =
      "最终交付：技术方案调研报告（/artifacts/solid-state-transformer/技术方案调研.md）和原理展示界面。"
    const out = linkifyArtifactPaths(text)
    expect(out).toContain(
      "（[技术方案调研.md](</artifacts/solid-state-transformer/技术方案调研.md>)）"
    )
  })

  it("支持 uploads / skills-draft 根", () => {
    expect(linkifyArtifactPaths("见 /uploads/data.csv")).toBe(
      "见 [data.csv](</uploads/data.csv>)"
    )
    expect(linkifyArtifactPaths("草稿 /skills-draft/foo/SKILL.md")).toBe(
      "草稿 [SKILL.md](</skills-draft/foo/SKILL.md>)"
    )
  })

  it("剥离句末 ASCII 标点，不吞进路径", () => {
    expect(linkifyArtifactPaths("see /artifacts/a/b.md.")).toBe(
      "see [b.md](</artifacts/a/b.md>)."
    )
    expect(linkifyArtifactPaths("/artifacts/x.md, 然后")).toBe(
      "[x.md](</artifacts/x.md>), 然后"
    )
  })

  it("不处理行内代码里的路径", () => {
    const text = "运行 `cat /artifacts/x.md` 查看"
    expect(linkifyArtifactPaths(text)).toBe(text)
  })

  it("不处理围栏代码块里的路径", () => {
    const text = "```\nread /artifacts/x.md\n```"
    expect(linkifyArtifactPaths(text)).toBe(text)
  })

  it("已有 markdown 链接原样保留（href 仍是产物路径，渲染层会出芯片）", () => {
    const text = "[报告](/artifacts/x.md)"
    expect(linkifyArtifactPaths(text)).toBe(text)
  })

  it("不处理自动链接 <...>", () => {
    const text = "</artifacts/x.md>"
    expect(linkifyArtifactPaths(text)).toBe(text)
  })

  it("一行里多个路径都被包装", () => {
    const out = linkifyArtifactPaths(
      "交付 /artifacts/a.md 与 /artifacts/b.html"
    )
    expect(out).toBe(
      "交付 [a.md](</artifacts/a.md>) 与 [b.html](</artifacts/b.html>)"
    )
  })

  it("非产物路径不动", () => {
    const text = "见 /etc/passwd 与 C:\\tmp\\x.md"
    expect(linkifyArtifactPaths(text)).toBe(text)
  })

  it("无产物路径时原样返回", () => {
    const text = "这是一段普通正文。"
    expect(linkifyArtifactPaths(text)).toBe(text)
  })

  it("空串安全", () => {
    expect(linkifyArtifactPaths("")).toBe("")
  })
})

describe("basenameOfPath", () => {
  it("取最后一段", () => {
    expect(basenameOfPath("/artifacts/a/b/c.md")).toBe("c.md")
    expect(basenameOfPath("/artifacts/x.md")).toBe("x.md")
  })
})
