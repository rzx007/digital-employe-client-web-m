import { describe, expect, it } from "vitest"
import { sanitizeAssistantContent } from "./sanitize-assistant-content"

describe("sanitizeAssistantContent", () => {
  it("保留纯净的模型正文，原样返回", () => {
    const text = "我来完成励磁分析调研报告的撰写。\n\n## 一、基本概念\n这是正文。"
    expect(sanitizeAssistantContent(text)).toBe(text)
  })

  it("剥掉 shell 工具注入的环境提示（整行）", () => {
    const text =
      "好的，开始执行。\n[shell 工作目录: C:\\Users\\x\\room-57\\artifacts]\n继续。"
    expect(sanitizeAssistantContent(text)).toBe("好的，开始执行。\n继续。")
  })

  it("剥掉 read_file 进度提示（整行）", () => {
    const text =
      "读取文件。\n[read_file 进度 · /artifacts/x.md · ⚠ 文件未读完（文件共 411 行，已读至第 100 行）]\n好的。"
    expect(sanitizeAssistantContent(text)).toBe("读取文件。\n好的。")
  })

  it("抹掉行内的 write/edit 失败回执", () => {
    const text =
      "我来完成报告。Cannot write to /报告.md because it already exists. Read and then make an edit, or write to a new path.文件已存在，先读取。"
    const out = sanitizeAssistantContent(text)
    expect(out).not.toContain("Cannot write to")
    expect(out).toContain("我来完成报告。")
    expect(out).toContain("文件已存在，先读取。")
  })

  it("抹掉 edit 成功/失败回执", () => {
    expect(
      sanitizeAssistantContent(
        "完成。Successfully replaced 1 instance(s) of the string in '/artifacts/x.md'继续下一步。"
      )
    ).toBe("完成。继续下一步。")
    expect(
      sanitizeAssistantContent("Error: String not found in file: 'placeholder'修正中。")
    ).toBe("修正中。")
  })

  it("删除 read_file 回显的连续行号文件原文（≥3 行）", () => {
    const text = [
      "让我读取文件确认内容：",
      "     1\t# 励磁分析调研报告",
      "     2\t",
      "     3\t## 1. 基本概念",
      "     4\t励磁系统是同步发电机的重要组成部分。",
      "现有内容结构完整。",
    ].join("\n")
    const out = sanitizeAssistantContent(text)
    expect(out).toBe("让我读取文件确认内容：\n现有内容结构完整。")
  })

  it("少于 3 行的「行号\\t」保留（可能是正常代码片段）", () => {
    const text = "示例：\n  1\tconst a = 1\n  2\tconst b = 2\n说明。"
    const out = sanitizeAssistantContent(text)
    expect(out).toContain("const a = 1")
    expect(out).toContain("const b = 2")
  })

  it("综合：截图里的真实脏数据被清理干净", () => {
    const text = [
      "我来完成励磁分析调研报告的撰写。",
      "",
      "Cannot write to /励磁分析调研报告.md because it already exists. Read and then make an edit, or write to a new path.Error: String not found in file: 'placeholder'文件已存在，让我先读取确认内容：",
      "     1\t# 励磁分析调研报告",
      "     2\t",
      "     3\t## 1. 基本概念",
      "     4\t励磁系统概述",
      "[read_file 进度 · /artifacts/励磁分析调研报告.md · ⚠ 文件未读完（文件共 411 行，已读至第 100 行）]",
      "Successfully replaced 1 instance(s) of the string in '/artifacts/励磁分析调研报告.md'",
    ].join("\n")
    const out = sanitizeAssistantContent(text)
    expect(out).toContain("我来完成励磁分析调研报告的撰写。")
    expect(out).toContain("文件已存在，让我先读取确认内容：")
    expect(out).not.toContain("Cannot write to")
    expect(out).not.toContain("Error: String not found")
    expect(out).not.toContain("read_file 进度")
    expect(out).not.toContain("Successfully replaced")
    expect(out).not.toContain("# 励磁分析调研报告")
  })

  it("空/非字符串安全", () => {
    expect(sanitizeAssistantContent("")).toBe("")
  })
})
