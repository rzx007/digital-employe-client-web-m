/**
 * 示例 08：结构化输出 (Structured Output)
 *
 * 进阶：展示如何让 DeepAgent 返回结构化数据
 * 包含：Zod schema 定义、数据验证、复杂嵌套结构
 *
 * 运行：npx tsx examples/08-structured-output.ts
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
    return `搜索结果：${query} 是一个热门的技术话题，相关信息如下...`
  },
  {
    name: "web_search",
    description: "搜索互联网",
    schema: z.object({ query: z.string() }),
  }
)

async function basicStructuredOutput() {
  console.log("=== 测试 1：基础结构化输出 ===\n")

  const weatherSchema = z.object({
    city: z.string().describe("城市名称"),
    temperature: z.number().describe("当前温度（摄氏度）"),
    condition: z.string().describe("天气状况"),
    humidity: z.number().describe("湿度百分比"),
    windSpeed: z.number().describe("风速（km/h）"),
    suggestion: z.string().describe("出行建议"),
  })

  const agent = createDeepAgent({
    model,
    responseFormat: { schema: weatherSchema } as any,
    tools: [webSearch],
    systemPrompt: "你是一个天气信息助手。根据用户请求返回结构化的天气数据。",
  })

  const result = await agent.invoke({
    messages: [{ role: "user", content: "查询北京的天气情况" }],
  })

  console.log("结构化输出：")
  console.log(JSON.stringify((result as any).structuredResponse, null, 2))
}

async function complexStructuredOutput() {
  console.log("\n=== 测试 2：复杂嵌套结构化输出 ===\n")

  const codeReviewSchema = z.object({
    overallGrade: z.enum(["A", "B", "C", "D", "F"]).describe("总体评分"),
    summary: z.string().describe("审查摘要"),
    issues: z
      .array(
        z.object({
          severity: z
            .enum(["critical", "warning", "info"])
            .describe("严重程度"),
          category: z.string().describe("问题类别"),
          description: z.string().describe("问题描述"),
          suggestion: z.string().describe("修复建议"),
        })
      )
      .describe("发现的问题列表"),
    metrics: z
      .object({
        readability: z.number().describe("可读性评分 1-10"),
        maintainability: z.number().describe("可维护性评分 1-10"),
        security: z.number().describe("安全性评分 1-10"),
        performance: z.number().describe("性能评分 1-10"),
      })
      .describe("代码质量指标"),
    highlights: z.array(z.string()).describe("代码亮点"),
  })

  const agent = createDeepAgent({
    model,
    responseFormat: { schema: codeReviewSchema } as any,
    tools: [webSearch],
    systemPrompt: "你是一个代码审查专家。请返回结构化的审查结果。",
  })

  const code = `function calc(a, b) {
  var r = a + b
  if (r > 100) { console.log("big") }
  return r
}`

  const result = await agent.invoke({
    messages: [
      {
        role: "user",
        content: `审查以下代码并返回结构化结果：\n\`\`\`javascript\n${code}\n\`\`\``,
      },
    ],
  })

  console.log("结构化审查结果：")
  console.log(JSON.stringify((result as any).structuredResponse, null, 2))
}

async function main() {
  await basicStructuredOutput()
  await complexStructuredOutput()
}

main().catch(console.error)
