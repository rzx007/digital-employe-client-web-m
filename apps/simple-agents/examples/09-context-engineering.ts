/**
 * 示例 09：上下文工程 (Context Engineering)
 *
 * 高级：展示上下文压缩、隔离、长期记忆的综合运用
 * 包含：运行时上下文传播、自定义中间件拦截、动态系统提示词
 *
 * 运行：npx tsx examples/09-context-engineering.ts
 */

import "dotenv/config"
import {
  createDeepAgent,
  CompositeBackend,
  StateBackend,
  FilesystemBackend,
} from "deepagents"
import { createMiddleware, tool } from "langchain"
import { ChatOpenAI } from "@langchain/openai"
import { z } from "zod"
import path from "node:path"

const model = new ChatOpenAI({
  model: "glm-4.7",
  openAIApiKey: process.env.GLM_API_KEY,
  configuration: {
    baseURL: process.env.GLM_BASE_URL,
  },
  temperature: 0,
})

async function runtimeContext() {
  console.log("=== 测试 1：运行时上下文传播 ===\n")

  const getUserInfo = tool(
    (_input: Record<string, unknown>, config: any) => {
      const userId = config.context?.userId ?? "anonymous"
      const role = config.context?.role ?? "user"
      return JSON.stringify({ userId, role, displayName: `用户_${userId}` })
    },
    {
      name: "get_user_info",
      description: "获取当前用户的信息",
      schema: z.object({}),
    }
  )

  const contextSchema = z.object({
    userId: z.string(),
    role: z.enum(["admin", "user", "guest"]),
  })

  const agent = createDeepAgent({
    model,
    tools: [getUserInfo],
    contextSchema,
    systemPrompt: `你是一个上下文感知的助手。
调用 get_user_info 工具查看当前用户信息。
根据用户的角色提供不同级别的服务。
请始终用中文回复。`,
  })

  const result = await agent.invoke(
    {
      messages: [{ role: "user", content: "请告诉我当前用户是谁，有什么权限" }],
    },
    { context: { userId: "user-001", role: "admin" } }
  )

  console.log((result.messages[result.messages.length - 1] as any).content)
}

async function customMiddleware() {
  console.log("\n=== 测试 2：自定义中间件（工具调用日志） ===\n")

  let callLog: Array<{ tool: string; timestamp: string }> = []

  const loggingMiddleware = createMiddleware({
    name: "LoggingMiddleware",
    wrapToolCall: async (request: any, handler: any) => {
      const entry = {
        tool: request.toolCall.name,
        timestamp: new Date().toISOString(),
      }
      callLog.push(entry)
      console.log(`  [日志] 调用工具: ${entry.tool} @ ${entry.timestamp}`)

      const result = await handler(request)

      console.log(`  [日志] 工具完成: ${entry.tool}`)
      return result
    },
  } as any)

  const simpleTool = tool(
    ({ question }: { question: string }) => {
      return `关于"${question}"的回答：这是一个示例响应。`
    },
    {
      name: "ask_question",
      description: "提出问题并获取回答",
      schema: z.object({ question: z.string() }),
    }
  )

  const agent = createDeepAgent({
    model,
    tools: [simpleTool],
    middleware: [loggingMiddleware],
    systemPrompt: "你是一个助手，可以使用 ask_question 工具。",
  })

  const result = await agent.invoke({
    messages: [
      {
        role: "user",
        content: "请帮我问两个问题：1)什么是TypeScript 2)什么是React",
      },
    ],
  })

  console.log(
    `\n回复：${(result.messages[result.messages.length - 1] as any).content}`
  )
  console.log(`\n工具调用日志（共 ${callLog.length} 次）：`)
  callLog.forEach((log, i) =>
    console.log(`  ${i + 1}. ${log.tool} @ ${log.timestamp}`)
  )
}

async function longTermMemory() {
  console.log("\n=== 测试 3：长期记忆（CompositeBackend） ===\n")

  const workDir = path.join(process.cwd(), "workspace", "memory-demo")

  const agent = createDeepAgent({
    model,
    systemPrompt: `你是一个有记忆能力的助手。

你有两种存储：
1. 默认临时存储 - 用于当前对话
2. /memories/ 路径 - 跨对话持久存储

规则：
- 用户告诉你重要信息时，保存到 /memories/preferences.txt
- 每次对话开始时，检查 /memories/ 是否有之前保存的信息

请始终用中文回复。`,
    backend: (config: any) =>
      new CompositeBackend(new StateBackend(config), {
        "/memories/": new FilesystemBackend({
          rootDir: path.join(workDir, "persistent"),
          virtualMode: true,
        }),
      }),
  })

  console.log("--- 第一次对话：告诉代理偏好 ---")
  const r1 = await agent.invoke({
    messages: [
      {
        role: "user",
        content:
          "我更喜欢简洁的回复风格，使用 TypeScript 开发，关注前端性能优化。请记住这些偏好。",
      },
    ],
  })
  console.log((r1.messages[r1.messages.length - 1] as any).content)

  console.log("\n--- 第二次对话（模拟新线程）：检查记忆 ---")
  const r2 = await agent.invoke({
    messages: [
      {
        role: "user",
        content: "你还记得我的偏好吗？根据我的偏好给我一些建议。",
      },
    ],
  })
  console.log((r2.messages[r2.messages.length - 1] as any).content)
}

async function main() {
  await runtimeContext()
  await customMiddleware()
  await longTermMemory()
}

main().catch(console.error)
