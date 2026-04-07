/**
 * 示例 03：流式输出
 *
 * 入门进阶：展示 DeepAgent 的流式调用方式
 * 包含三种流式模式：简单流式、事件流式、原始事件流式
 *
 * 运行：npx tsx examples/03-streaming.ts
 */

import "dotenv/config"
import { createDeepAgent } from "deepagents"
import { ChatOpenAI } from "@langchain/openai"

const model = new ChatOpenAI({
  model: "glm-4.7",
  openAIApiKey: process.env.GLM_API_KEY,
  configuration: {
    baseURL: process.env.GLM_BASE_URL,
  },
  temperature: 0,
})

async function simpleStream() {
  console.log("=== 模式 1：简单流式 (agent.stream) ===\n")

  const agent = createDeepAgent({
    model,
    systemPrompt: "你是一个中文助手，请用中文回复。",
  })

  const streamResult = await agent.stream({
    messages: [{ role: "user", content: "用三句话介绍什么是大语言模型" }],
  })

  for await (const chunk of streamResult) {
    const state = chunk as any
    if (state.messages && state.messages.length > 0) {
      const lastMsg = state.messages[state.messages.length - 1]
      if (typeof lastMsg.content === "string") {
        process.stdout.write(lastMsg.content)
      }
    }
  }
  console.log("\n")
}

async function eventStream() {
  console.log("=== 模式 2：事件流式 (agent.streamEvents) ===\n")

  const agent = createDeepAgent({
    model,
    systemPrompt: "你是一个中文助手，请用中文回复。",
  })

  const eventStream = agent.streamEvents(
    {
      messages: [
        { role: "user", content: "列举三个 JavaScript 框架并简述特点" },
      ],
    },
    { configurable: { thread_id: `stream-${Date.now()}` } }
  )

  for await (const event of eventStream) {
    if (
      event.event === "on_chat_model_stream" &&
      event.data?.chunk?.content &&
      typeof event.data.chunk.content === "string"
    ) {
      process.stdout.write(event.data.chunk.content)
    }
  }
  console.log("\n")
}

async function verboseStream() {
  console.log("=== 模式 3：详细事件流（包含工具调用信息） ===\n")

  const agent = createDeepAgent({
    model,
    systemPrompt: "你是一个中文助手。",
  })

  const eventStream = agent.streamEvents(
    {
      messages: [
        {
          role: "user",
          content: "使用 write_todos 创建一个任务：学习 TypeScript",
        },
      ],
    },
    { configurable: { thread_id: `verbose-${Date.now()}` } }
  )

  for await (const event of eventStream) {
    if (event.event === "on_tool_start") {
      console.log(
        `[工具调用] ${event.name}: ${JSON.stringify(event.data?.input)}`
      )
    } else if (event.event === "on_tool_end") {
      const output =
        typeof event.data?.output === "string"
          ? event.data.output
          : JSON.stringify(event.data?.output)
      console.log(
        `[工具结果] ${event.name}: ${output.substring(0, 100)}${output.length > 100 ? "..." : ""}`
      )
    } else if (
      event.event === "on_chat_model_stream" &&
      event.data?.chunk?.content &&
      typeof event.data.chunk.content === "string"
    ) {
      process.stdout.write(event.data.chunk.content)
    }
  }
  console.log("\n")
}

async function main() {
  await simpleStream()
  await eventStream()
  await verboseStream()
}

main().catch(console.error)
