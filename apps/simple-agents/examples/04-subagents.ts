/**
 * 示例 04：子代理 (Subagents)
 *
 * 进阶：展示如何定义和使用专业化子代理
 * 包含：自定义子代理、覆盖通用子代理、子代理上下文传播
 *
 * 运行：npx tsx examples/04-subagents.ts
 */

import "dotenv/config"
import { createDeepAgent } from "deepagents"
import { tool } from "langchain"
import { ChatOpenAI } from "@langchain/openai"
import { z } from "zod"

const model = new ChatOpenAI({
  model: "glm-4.7",
  openAIApiKey: process.env.GLM_API_KEY,
  configuration: {
    baseURL: process.env.GLM_BASE_URL,
  },
  temperature: 0,
})

const webSearch = tool(
  ({ query }: { query: string }) => {
    return JSON.stringify({
      results: [
        {
          title: `${query} - 维基百科`,
          snippet: `${query}是一个重要的技术概念...`,
          url: "https://wiki.example.com",
        },
        {
          title: `${query} - 技术博客`,
          snippet: `深入了解${query}的最佳实践和设计模式。`,
          url: "https://blog.example.com",
        },
      ],
    })
  },
  {
    name: "web_search",
    description: "搜索互联网获取最新信息",
    schema: z.object({ query: z.string().describe("搜索关键词") }),
  }
)

const codeGenerator = tool(
  ({ language, description }: { language: string; description: string }) => {
    const templates: Record<string, string> = {
      python: `# ${description}\ndef main():\n    print("Hello from Python!")\n\nif __name__ == "__main__":\n    main()`,
      javascript: `// ${description}\nfunction main() {\n  console.log("Hello from JavaScript!");\n}\n\nmain();`,
      typescript: `// ${description}\nfunction main(): void {\n  console.log("Hello from TypeScript!");\n}\n\nmain();`,
    }
    return templates[language] || `// ${description}\n// Code for ${language}`
  },
  {
    name: "code_generator",
    description: "根据描述生成指定语言的代码模板",
    schema: z.object({
      language: z.string().describe("编程语言"),
      description: z.string().describe("代码功能描述"),
    }),
  }
)

async function basicSubagents() {
  console.log("=== 测试 1：基础子代理使用 ===\n")

  const agent = createDeepAgent({
    model,
    tools: [webSearch, codeGenerator],
    subagents: [
      {
        name: "researcher",
        description:
          "专业的研究助理，用于搜索和总结信息。当需要搜索互联网或深入研究某个主题时使用。",
        systemPrompt: `你是一个专业的研究助理。
        
工作流程：
1. 使用 web_search 搜索相关信息
2. 分析和总结搜索结果
3. 返回简洁的研究报告（不超过300字）

输出格式：
- 核心发现（要点列表）
- 简要总结（2-3句话）`,
        tools: [webSearch],
      },
      {
        name: "coder",
        description:
          "代码生成专家，用于编写各种编程语言的代码。当需要生成代码、代码模板或解决编程问题时使用。",
        systemPrompt: `你是一个代码生成专家。

工作流程：
1. 理解用户的代码需求
2. 使用 code_generator 生成代码
3. 在代码中添加必要的注释和文档

要求：
- 生成可运行的代码
- 包含错误处理
- 添加适当的注释`,
        tools: [codeGenerator],
      },
    ],
    systemPrompt: `你是一个项目协调员，负责管理专业化子代理。

你有两个子代理可用：
- researcher：用于搜索和研究
- coder：用于代码生成

根据用户需求，使用 task 工具将任务委派给合适的子代理。
请始终用中文回复。`,
  })

  const result = await agent.invoke({
    messages: [
      {
        role: "user",
        content:
          "帮我搜索一下 TypeScript 最新版本有什么新特性，然后生成一段 TypeScript 代码展示这些特性",
      },
    ],
  })

  console.log((result.messages[result.messages.length - 1] as any).content)
}

async function overrideGeneralPurpose() {
  console.log("\n=== 测试 2：覆盖通用子代理 ===\n")

  const agent = createDeepAgent({
    model,
    tools: [webSearch],
    subagents: [
      {
        name: "general-purpose",
        description: "通用任务代理，用于处理一般性的多步骤任务",
        systemPrompt: `你是一个高效的通用助手。
        
重要：你的回复必须简洁，不超过200字。
不要包含原始数据，只返回精炼的总结。`,
        tools: [webSearch],
      },
    ],
    systemPrompt: `你是一个协调员。将复杂任务委派给 general-purpose 子代理。
请始终用中文回复。`,
  })

  const result = await agent.invoke({
    messages: [
      { role: "user", content: "帮我研究一下 2026 年前端开发的主要趋势" },
    ],
  })

  console.log((result.messages[result.messages.length - 1] as any).content)
}

async function main() {
  await basicSubagents()
  await overrideGeneralPurpose()
}

main().catch(console.error)
