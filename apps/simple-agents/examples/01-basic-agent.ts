/**
 * 示例 01：最简单的 DeepAgent 创建与调用
 *
 * 概念入门：展示如何用最少的代码创建一个能工作的 DeepAgent
 *
 * 运行：npx tsx examples/01-basic-agent.ts
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

async function main() {
  console.log("=== 示例 01：基础 DeepAgent ===\n")

  const agent = createDeepAgent({
    model,
    systemPrompt: `你是一个友好的中文助手。请用中文回复。
    
你可以使用以下内置工具：
- write_todos：管理任务列表
- ls：列出目录
- read_file：读取文件
- write_file：写入文件
- edit_file：编辑文件
- task：派生子代理

对于简单问题，直接回答即可。`,
  })

  const result = await agent.invoke({
    messages: [
      {
        role: "user",
        content:
          "你好！请用 write_todos 工具创建一个任务列表，包含：学习 DeepAgents、编写示例代码、部署到生产环境三个任务",
      },
    ],
  })

  const lastMessage = result.messages[result.messages.length - 1]
  const content =
    typeof lastMessage.content === "string"
      ? lastMessage.content
      : JSON.stringify(lastMessage.content)

  console.log("Agent 回复：")
  console.log(content)

  if (result.todos && result.todos.length > 0) {
    console.log("\n当前任务列表：")
    for (const todo of result.todos) {
      console.log(`  [${todo.status}] ${todo.content}`)
    }
  }
}

main().catch(console.error)
