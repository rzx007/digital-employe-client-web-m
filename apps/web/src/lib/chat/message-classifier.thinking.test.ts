import type { UIMessage } from "ai"
import { describe, expect, it } from "vitest"
import {
  classifyMessageParts,
  type ClassifiedBlock,
} from "./message-classifier"

function assistantMessage(id: string, parts: UIMessage["parts"]): UIMessage {
  return { id, role: "assistant", parts } as unknown as UIMessage
}

function textPart(text: string): UIMessage["parts"][number] {
  return { type: "text", text } as unknown as UIMessage["parts"][number]
}

function reasoningPart(text: string): UIMessage["parts"][number] {
  return {
    type: "text",
    text,
    providerMetadata: { langchain: { lcSource: "reasoning" } },
  } as unknown as UIMessage["parts"][number]
}

function readToolPart(filePath: string, toolCallId: string) {
  return {
    type: "tool-read_file",
    toolCallId,
    state: "output-available",
    input: { file_path: filePath },
    output: "ok",
  } as unknown as UIMessage["parts"][number]
}

function blocksOfKind(
  blocks: ClassifiedBlock[],
  kind: ClassifiedBlock["kind"]
) {
  return blocks.filter((b) => b.kind === kind)
}

function thinkingText(blocks: ClassifiedBlock[]): string[] {
  return blocksOfKind(blocks, "thinking").map(
    (b) => (b as Extract<ClassifiedBlock, { kind: "thinking" }>).text
  )
}

function responseText(blocks: ClassifiedBlock[]): string[] {
  return blocksOfKind(blocks, "final-response").map(
    (b) => (b as Extract<ClassifiedBlock, { kind: "final-response" }>).text
  )
}

describe("Gap A — inline <think> 全场景显示", () => {
  it("纯聊天（无工具）：<think> 段抽成思考块，正文保留", () => {
    const message = assistantMessage("m1", [
      textPart("<think>我先分析一下问题</think>这是给用户的答案"),
    ])

    const blocks = classifyMessageParts(message)

    expect(thinkingText(blocks)).toContain("我先分析一下问题")
    expect(responseText(blocks)).toContain("这是给用户的答案")
  })

  it("正文里不应残留 <think> 标签或思考内容", () => {
    const message = assistantMessage("m2", [
      textPart("<think>内部推理</think>对外回答"),
    ])

    const blocks = classifyMessageParts(message)

    const joined = responseText(blocks).join("")
    expect(joined).not.toContain("<think>")
    expect(joined).not.toContain("内部推理")
    expect(joined).toContain("对外回答")
  })

  it("工具调用之前的 <think> 仍显示为思考（无回归）", () => {
    const message = assistantMessage("m3", [
      textPart("<think>该读文件了</think>"),
      readToolPart("/home/user/a.txt", "t1"),
      textPart("读完了，结论如下"),
    ])

    const blocks = classifyMessageParts(message)

    expect(thinkingText(blocks)).toContain("该读文件了")
    expect(responseText(blocks)).toContain("读完了，结论如下")
  })
})

describe("Gap B — reasoning 文本 part 渲染为思考", () => {
  it("带 lcSource=reasoning 的 text part → 思考块", () => {
    const message = assistantMessage("m4", [
      reasoningPart("这是模型的思考过程"),
      textPart("这是最终回答"),
    ])

    const blocks = classifyMessageParts(message)

    expect(thinkingText(blocks)).toContain("这是模型的思考过程")
    expect(responseText(blocks)).toContain("这是最终回答")
  })
})
