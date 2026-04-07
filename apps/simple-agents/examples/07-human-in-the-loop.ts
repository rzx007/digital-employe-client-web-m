/**
 * 示例 07：Human-in-the-Loop 人机协作
 *
 * 进阶：展示如何配置和实现人机协作审批流程
 * 包含：工具级中断、审批/编辑/拒绝决策、子代理中断
 *
 * 注意：此示例需要 checkpointer 支持
 *
 * 运行：npx tsx examples/07-human-in-the-loop.ts
 */

import "dotenv/config"
import { createDeepAgent } from "deepagents"
import { tool } from "langchain"
import { ChatOpenAI } from "@langchain/openai"
import { MemorySaver } from "@langchain/langgraph"
import { z } from "zod"
import { Command } from "@langchain/langgraph"

const model = new ChatOpenAI({
  model: "glm-4.7",
  openAIApiKey: process.env.GLM_API_KEY,
  configuration: {
    baseURL: process.env.GLM_BASE_URL,
  },
  temperature: 0,
})

const deleteFile = tool(
  ({ path }: { path: string }) => {
    return `文件 ${path} 已成功删除`
  },
  {
    name: "delete_file",
    description: "删除指定路径的文件。此操作不可逆。",
    schema: z.object({ path: z.string().describe("要删除的文件路径") }),
  }
)

const writeFile = tool(
  ({ path, content }: { path: string; content: string }) => {
    return `文件 ${path} 已成功写入，共 ${content.length} 个字符`
  },
  {
    name: "write_file",
    description: "创建或覆盖文件",
    schema: z.object({
      path: z.string().describe("文件路径"),
      content: z.string().describe("文件内容"),
    }),
  }
)

const readFile = tool(
  ({ path }: { path: string }) => {
    return `文件 ${path} 的内容：这是一个示例文件内容。`
  },
  {
    name: "read_file",
    description: "读取文件内容",
    schema: z.object({ path: z.string().describe("文件路径") }),
  }
)

async function basicInterrupt() {
  console.log("=== 测试 1：基础人机协作中断 ===\n")

  const checkpointer = new MemorySaver()

  const agent = createDeepAgent({
    model,
    tools: [deleteFile, writeFile, readFile],
    interruptOn: {
      delete_file: { allowedDecisions: ["approve", "edit", "reject"] },
      write_file: { allowedDecisions: ["approve", "reject"] },
      read_file: false,
    },
    checkpointer,
    systemPrompt: `你是一个文件管理助手。

注意：
- delete_file 操作需要人工审批（可批准/编辑/拒绝）
- write_file 操作需要人工审批（可批准/拒绝）
- read_file 操作不需要审批

请始终用中文回复。`,
  })

  const threadId = `hitl-${Date.now()}`
  const config = { configurable: { thread_id: threadId } }

  console.log("用户请求：删除 temp.txt 和读取 config.json\n")

  let result = await agent.invoke(
    {
      messages: [
        {
          role: "user",
          content: "请删除 temp.txt 文件，然后读取 config.json 的内容",
        },
      ],
    },
    config
  )

  if (result.__interrupt__) {
    console.log("--- 检测到中断！需要人工审批 ---\n")

    const interrupts = (result.__interrupt__ as any)[0].value
    const actionRequests = interrupts.actionRequests

    console.log(`待审批操作数量：${actionRequests.length}`)
    for (let i = 0; i < actionRequests.length; i++) {
      const action = actionRequests[i]
      console.log(`\n操作 ${i + 1}：${action.name}`)
      console.log(`参数：${JSON.stringify(action.args, null, 2)}`)
    }

    console.log("\n--- 模拟用户决策 ---")
    const decisions = actionRequests.map((action: any) => {
      if (action.name === "delete_file") {
        console.log("拒绝删除文件操作")
        return { type: "reject" }
      }
      return { type: "approve" }
    })

    console.log("\n--- 恢复执行 ---\n")
    result = await agent.invoke(new Command({ resume: { decisions } }), config)

    if (!result.__interrupt__) {
      console.log("执行完成！最终回复：")
      console.log((result.messages[result.messages.length - 1] as any).content)
    }
  } else {
    console.log("未触发中断，直接完成：")
    console.log((result.messages[result.messages.length - 1] as any).content)
  }
}

async function main() {
  await basicInterrupt()
}

main().catch(console.error)
