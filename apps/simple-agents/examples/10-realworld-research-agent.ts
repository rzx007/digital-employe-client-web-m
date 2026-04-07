/**
 * 示例 10：完整的研究代理实战案例
 *
 * 高级实战：构建一个完整的研究代理系统
 * 整合了 DeepAgents 的所有核心能力：
 * - 自定义工具（搜索、摘要、报告生成）
 * - 子代理（研究、写作、审核）
 * - 任务规划（write_todos）
 * - 文件系统（保存研究结果）
 * - 结构化输出（报告格式）
 * - 流式输出（实时反馈）
 *
 * 运行：npx tsx examples/10-realworld-research-agent.ts
 */

import "dotenv/config"
import { createDeepAgent, FilesystemBackend } from "deepagents"
import { tool } from "langchain"
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

const searchTool = tool(
  async ({ query, maxResults = 3 }: { query: string; maxResults?: number }) => {
    const mockResults: Record<
      string,
      Array<{ title: string; snippet: string; url: string }>
    > = {
      人工智能: [
        {
          title: "2026 AI 趋势报告",
          snippet: "AI Agent 成为核心发展方向，多模态能力持续提升...",
          url: "https://example.com/ai-trends",
        },
        {
          title: "大模型技术演进",
          snippet: "推理能力增强，上下文窗口扩大，成本持续下降...",
          url: "https://example.com/llm-evolution",
        },
        {
          title: "AI 应用落地分析",
          snippet: "企业级AI应用加速落地，编程助手市场增长迅速...",
          url: "https://example.com/ai-applications",
        },
      ],
      前端开发: [
        {
          title: "2026 前端技术趋势",
          snippet:
            "React Server Components 成为主流，Islands Architecture 广泛采用...",
          url: "https://example.com/frontend-trends",
        },
        {
          title: "WebAssembly 新进展",
          snippet: "WASI 标准成熟，Wasm 在边缘计算中发挥重要作用...",
          url: "https://example.com/wasm",
        },
      ],
    }

    const results = mockResults[query] || [
      {
        title: `${query} - 综合分析`,
        snippet: `${query}是当前技术领域的热点话题，正在快速发展中。`,
        url: "https://example.com/general",
      },
    ]

    return JSON.stringify({
      query,
      results: results.slice(0, maxResults),
      totalResults: results.length,
    })
  },
  {
    name: "web_search",
    description: "搜索互联网获取最新信息。支持指定最大结果数。",
    schema: z.object({
      query: z.string().describe("搜索关键词"),
      maxResults: z.number().optional().default(3).describe("最大返回结果数"),
    }),
  }
)

const summarizeTool = tool(
  ({ content, maxLength = 200 }: { content: string; maxLength?: number }) => {
    const summary =
      content.length > maxLength
        ? content.substring(0, maxLength) + "..."
        : content
    return JSON.stringify({
      originalLength: content.length,
      summaryLength: summary.length,
      summary,
    })
  },
  {
    name: "summarize",
    description: "对文本内容进行摘要，可指定最大长度",
    schema: z.object({
      content: z.string().describe("要摘要的文本"),
      maxLength: z.number().optional().default(200).describe("摘要最大长度"),
    }),
  }
)

async function main() {
  console.log("=== 完整研究代理系统 ===\n")
  console.log("系统架构：")
  console.log("  主代理（协调员）")
  console.log("    ├── researcher 子代理（搜索研究）")
  console.log("    ├── writer 子代理（报告撰写）")
  console.log("    └── reviewer 子代理（质量审核）")
  console.log()

  const workDir = path.join(process.cwd(), "workspace", "research-output")

  const agent = createDeepAgent({
    model,
    tools: [searchTool, summarizeTool],
    subagents: [
      {
        name: "researcher",
        description:
          "专业研究助理。当需要搜索信息、收集数据、深入研究某个主题时使用此子代理。",
        systemPrompt: `你是一个专业的研究助理。

工作流程：
1. 使用 web_search 搜索相关信息（至少搜索2次不同角度）
2. 使用 summarize 对搜索结果进行摘要
3. 将关键发现保存到 /research/notes.md 文件

输出要求：
- 返回不超过300字的研究总结
- 包含主要发现和数据支持
- 列出信息来源

重要：保持回复简洁，不要返回原始搜索数据。`,
        tools: [searchTool, summarizeTool],
      },
      {
        name: "writer",
        description: "专业写作助理。当需要撰写报告、文章、文档时使用此子代理。",
        systemPrompt: `你是一个专业的技术写作助理。

工作流程：
1. 阅读研究笔记（如有 /research/notes.md）
2. 基于研究内容撰写结构化报告
3. 将完整报告写入 /research/report.md

报告结构：
# 标题
## 摘要
## 背景分析
## 核心发现
## 趋势预测
## 建议
## 参考来源

重要：保持专业、客观的写作风格。`,
        tools: [searchTool],
      },
      {
        name: "reviewer",
        description:
          "质量审核助理。当需要审核报告质量、检查事实准确性时使用此子代理。",
        systemPrompt: `你是一个报告审核专家。

审核维度：
1. 内容准确性 - 事实和数据是否可靠
2. 结构完整性 - 报告结构是否合理
3. 可读性 - 语言是否清晰易懂
4. 实用性 - 建议是否有可操作性

输出格式：
- 总体评分（A/B/C/D）
- 各维度评分
- 改进建议（如需要）
- 审核结论

重要：保持简洁，审核意见不超过200字。`,
        tools: [searchTool],
      },
    ],
    backend: new FilesystemBackend({
      rootDir: workDir,
      virtualMode: true,
    }),
    systemPrompt: `你是一个研究项目管理员，负责协调整个研究流程。

研究流程：
1. 使用 write_todos 创建研究计划
2. 将搜索任务委派给 researcher 子代理（使用 task 工具）
3. 将写作任务委派给 writer 子代理（使用 task 工具）
4. 将审核任务委派给 reviewer 子代理（使用 task 工具）
5. 汇总所有结果，给出最终报告

注意事项：
- 使用 task 工具委派任务时，确保子代理名称正确
- 每个步骤完成后更新任务状态
- 最终汇总各子代理的结果

请始终用中文回复。`,
  })

  const topic = "2026年人工智能和前端开发的融合趋势"
  console.log(`研究主题：${topic}\n`)
  console.log("开始研究...\n")

  const result = await agent.invoke({
    messages: [
      {
        role: "user",
        content: `请对"${topic}"进行深入研究。

具体要求：
1. 制定研究计划
2. 搜索相关信息
3. 撰写研究报告
4. 审核报告质量

请按步骤执行，每步完成后更新任务状态。`,
      },
    ],
  })

  console.log("\n" + "=".repeat(60))
  console.log("最终结果：")
  console.log("=".repeat(60) + "\n")

  const lastMessage = result.messages[result.messages.length - 1]
  const content =
    typeof lastMessage.content === "string"
      ? lastMessage.content
      : JSON.stringify(lastMessage.content)

  console.log(content)

  if (result.todos && result.todos.length > 0) {
    console.log("\n任务完成状态：")
    for (const todo of result.todos) {
      const icon =
        todo.status === "completed"
          ? "✅"
          : todo.status === "in_progress"
            ? "🔄"
            : "⏳"
      console.log(`  ${icon} [${todo.status}] ${todo.content}`)
    }
  }
}

main().catch(console.error)
