/**
 * 示例 02：添加自定义工具
 *
 * 入门进阶：展示如何为 DeepAgent 添加自定义工具
 * 演示了 langchain 的 tool() 函数和 Zod schema 的使用
 *
 * 运行：npx tsx examples/02-custom-tools.ts
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

const getWeather = tool(
  ({ city }: { city: string }) => {
    const weatherData: Record<string, { temp: number; condition: string }> = {
      北京: { temp: 22, condition: "晴天" },
      上海: { temp: 18, condition: "多云" },
      深圳: { temp: 28, condition: "阵雨" },
      广州: { temp: 30, condition: "雷阵雨" },
    }
    const data = weatherData[city] || { temp: 25, condition: "未知" }
    return JSON.stringify({ city, ...data })
  },
  {
    name: "get_weather",
    description: "获取指定城市的天气信息，包括温度和天气状况",
    schema: z.object({
      city: z.string().describe("城市名称，如：北京、上海"),
    }),
  }
)

const calculator = tool(
  ({ expression }: { expression: string }) => {
    try {
      const sanitized = expression.replace(/[^0-9+\-*/().%\s]/g, "")
      const result = Function(`"use strict"; return (${sanitized})`)()
      return `计算结果：${expression} = ${result}`
    } catch {
      return `无法计算表达式：${expression}，请检查格式`
    }
  },
  {
    name: "calculator",
    description: "计算数学表达式。支持加减乘除、括号和百分号",
    schema: z.object({
      expression: z
        .string()
        .describe("要计算的数学表达式，如：(100 + 200) * 0.8"),
    }),
  }
)

const getTimestamp = tool(
  () => {
    const now = new Date()
    return JSON.stringify({
      iso: now.toISOString(),
      local: now.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }),
      unix: Math.floor(now.getTime() / 1000),
    })
  },
  {
    name: "get_timestamp",
    description: "获取当前时间戳信息，包括 ISO 格式、本地时间和 Unix 时间戳",
    schema: z.object({}),
  }
)

async function main() {
  console.log("=== 示例 02：自定义工具 ===\n")

  const agent = createDeepAgent({
    model,
    tools: [getWeather, calculator, getTimestamp],
    systemPrompt: `你是一个多功能中文助手，拥有以下自定义工具：

1. get_weather - 查询城市天气
2. calculator - 数学计算
3. get_timestamp - 获取当前时间

请根据用户需求选择合适的工具，用中文回复。`,
  })

  console.log("--- 测试 1：天气查询 ---")
  const r1 = await agent.invoke({
    messages: [
      {
        role: "user",
        content: "帮我查一下北京和上海的天气，然后对比一下哪个更适合户外运动",
      },
    ],
  })
  console.log((r1.messages[r1.messages.length - 1] as any).content)

  console.log("\n--- 测试 2：数学计算 ---")
  const r2 = await agent.invoke({
    messages: [
      { role: "user", content: "计算一下：(1280 + 760) * 0.85 - 200" },
    ],
  })
  console.log((r2.messages[r2.messages.length - 1] as any).content)

  console.log("\n--- 测试 3：组合工具调用 ---")
  const r3 = await agent.invoke({
    messages: [
      { role: "user", content: "现在几点了？帮我算一下距离今天结束还有多少秒" },
    ],
  })
  console.log((r3.messages[r3.messages.length - 1] as any).content)
}

main().catch(console.error)
