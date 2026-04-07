/**
 * 示例 06：记忆系统与技能系统
 *
 * 进阶：展示 Memory (AGENTS.md) 和 Skills 的使用
 * 包含：加载记忆文件、使用技能进行渐进式披露
 *
 * 运行：npx tsx examples/06-memory-skills.ts
 */

import "dotenv/config"
import { createDeepAgent, type FileData } from "deepagents"
import { ChatOpenAI } from "@langchain/openai"
const model = new ChatOpenAI({
  model: "glm-4.7",
  openAIApiKey: process.env.GLM_API_KEY,
  configuration: {
    baseURL: process.env.GLM_BASE_URL,
  },
  temperature: 0,
})

function createFileData(content: string): FileData {
  const now = new Date().toISOString()
  return {
    content: content.split("\n"),
    created_at: now,
    modified_at: now,
  }
}

async function memoryDemo() {
  console.log("=== 测试 1：Memory 记忆系统 ===\n")

  const agentsMd = `# 项目约定

## 编码规范
- 使用 TypeScript strict 模式
- 优先使用函数式编程
- 变量命名使用 camelCase
- 组件命名使用 PascalCase
- 使用中文编写注释和文档

## 项目信息
- 项目名称：simple-agents
- 技术栈：TypeScript + Hono + DeepAgents
- 包管理器：pnpm

## 偏好
- 回复语言：中文
- 代码风格：简洁、无分号
- 测试策略：单元测试优先`

  const agent = createDeepAgent({
    model,
    memory: ["/AGENTS.md"],
    systemPrompt: "你是一个遵循项目约定的助手。请始终用中文回复。",
  })

  const result = await agent.invoke({
    messages: [
      {
        role: "user",
        content:
          "根据你的记忆，请告诉我这个项目使用什么技术栈？编码规范有哪些？",
      },
    ],
    files: {
      "/AGENTS.md": createFileData(agentsMd),
    },
  } as any)

  console.log((result.messages[result.messages.length - 1] as any).content)
}

async function skillsDemo() {
  console.log("\n=== 测试 2：Skills 技能系统 ===\n")

  const skillMd = `---
name: code-review
description: 使用此技能进行代码审查，分析代码质量、安全性和最佳实践。当用户要求审查代码或检查代码质量时使用。
---

# Code Review 技能

## 概述
此技能用于执行全面的代码审查，帮助识别潜在问题和改进建议。

## 审查流程

### 1. 代码质量
- 检查命名是否清晰一致
- 检查函数是否单一职责
- 检查是否有重复代码
- 检查错误处理是否完善

### 2. 安全性
- 检查是否有注入漏洞
- 检查敏感信息是否泄露
- 检查输入验证是否充分

### 3. 性能
- 检查是否有不必要的计算
- 检查是否可以优化算法
- 检查内存使用是否合理

### 4. 最佳实践
- 检查是否遵循项目编码规范
- 检查类型安全
- 检查是否有过时的 API 使用

## 输出格式
审查完成后，按以下格式输出：
- 总体评分（A/B/C/D）
- 发现的问题列表
- 改进建议
- 亮点（做得好的地方）`

  const agent = createDeepAgent({
    model,
    skills: ["/skills/"],
    systemPrompt: "你是一个代码审查专家。请始终用中文回复。",
  })

  const codeToReview = `
function getData(id) {
  var data = fetch('/api/data/' + id)
  console.log(data)
  return data
}

function process(items) {
  let result = []
  for (let i = 0; i < items.length; i++) {
    if (items[i].active == true) {
      result.push(items[i].name)
    }
  }
  return result
}`

  const skillResult = await agent.invoke({
    messages: [
      {
        role: "user",
        content: `请使用 code-review 技能审查以下代码：\n\`\`\`javascript\n${codeToReview}\n\`\`\``,
      },
    ],
    files: {
      "/skills/code-review/SKILL.md": createFileData(skillMd),
    },
  } as any)

  console.log(
    (skillResult.messages[skillResult.messages.length - 1] as any).content
  )
}

async function main() {
  await memoryDemo()
  await skillsDemo()
}

main().catch(console.error)
