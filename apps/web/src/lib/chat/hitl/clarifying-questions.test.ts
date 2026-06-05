import { describe, expect, it } from "vitest"

import {
  buildClarifyRespondMessage,
  CLARIFY_CHOICE_CUSTOM_PREFIX,
  formatClarifyAnswer,
  parseClarifyingQuestions,
  type ClarifyingQuestion,
} from "./clarifying-questions"

const choiceQuestion: ClarifyingQuestion = {
  id: "q1",
  prompt: "文档类型？",
  required: true,
  type: "choice",
  options: ["技术方案", "标书", "其他（请说明）"],
}

describe("formatClarifyAnswer", () => {
  it("returns placeholder for empty answers", () => {
    expect(formatClarifyAnswer(choiceQuestion, "")).toBe("（未作答）")
    expect(formatClarifyAnswer(choiceQuestion, "   ")).toBe("（未作答）")
  })

  it("passes through selected option text unchanged", () => {
    expect(formatClarifyAnswer(choiceQuestion, "技术方案")).toBe("技术方案")
    expect(formatClarifyAnswer(choiceQuestion, "其他（请说明）")).toBe(
      "其他（请说明）"
    )
  })

  it("prefixes custom choice answers with 其他：", () => {
    expect(formatClarifyAnswer(choiceQuestion, "专利分析报告")).toBe(
      `${CLARIFY_CHOICE_CUSTOM_PREFIX}专利分析报告`
    )
  })

  it("does not prefix text question answers", () => {
    const textQuestion: ClarifyingQuestion = {
      id: "q2",
      prompt: "补充说明",
      type: "text",
    }
    expect(formatClarifyAnswer(textQuestion, "任意内容")).toBe("任意内容")
  })
})

describe("buildClarifyRespondMessage", () => {
  it("embeds custom choice answers with prefix in numbered body", () => {
    const message = buildClarifyRespondMessage(
      [choiceQuestion],
      { q1: "专利分析报告" },
      "long_document"
    )
    expect(message).toContain("用户对长文档澄清问题的回答：")
    expect(message).toContain(
      `答：${CLARIFY_CHOICE_CUSTOM_PREFIX}专利分析报告`
    )
  })

  it("appends optional details after per-question answers", () => {
    const message = buildClarifyRespondMessage(
      [choiceQuestion],
      { q1: "标书" },
      "general",
      "全局补充"
    )
    expect(message).toContain("答：标书")
    expect(message).toContain("补充说明：全局补充")
  })
})

describe("parseClarifyingQuestions", () => {
  it("infers choice type when options are present", () => {
    const questions = parseClarifyingQuestions([
      {
        id: "q1",
        prompt: "读者？",
        options: ["内部", "客户"],
      },
    ])
    expect(questions).toHaveLength(1)
    expect(questions[0]?.type).toBe("choice")
    expect(questions[0]?.options).toEqual(["内部", "客户"])
  })
})
