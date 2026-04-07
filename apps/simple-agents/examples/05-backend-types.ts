/**
 * 示例 05：Backend 文件系统后端类型
 *
 * 进阶：展示各种 Backend 类型的使用与对比
 * 包含：StateBackend、FilesystemBackend、CompositeBackend
 *
 * 运行：npx tsx examples/05-backend-types.ts
 */

import "dotenv/config"
import {
  createDeepAgent,
  FilesystemBackend,
  CompositeBackend,
  StateBackend,
} from "deepagents"
import { ChatOpenAI } from "@langchain/openai"
import path from "node:path"
import fs from "node:fs"

const model = new ChatOpenAI({
  model: "glm-4.7",
  openAIApiKey: process.env.GLM_API_KEY,
  configuration: {
    baseURL: process.env.GLM_BASE_URL,
  },
  temperature: 0,
})

const WORK_DIR = path.join(process.cwd(), "workspace", "backend-demo")
if (!fs.existsSync(WORK_DIR)) {
  fs.mkdirSync(WORK_DIR, { recursive: true })
}

async function filesystemBackend() {
  console.log("=== 测试 1：FilesystemBackend（本地磁盘） ===\n")

  const agent = createDeepAgent({
    model,
    systemPrompt: `你是一个文件管理助手，可以读写本地文件。
工作目录：${WORK_DIR}

你可以使用 ls、read_file、write_file、edit_file、glob、grep 等工具。
请始终用中文回复。`,
    backend: new FilesystemBackend({
      rootDir: WORK_DIR,
      virtualMode: true,
    }),
  })

  const r1 = await agent.invoke({
    messages: [
      {
        role: "user",
        content:
          "请在工作目录创建一个 notes.txt 文件，内容是'这是通过 FilesystemBackend 创建的文件'，然后读取它确认内容",
      },
    ],
  })
  console.log((r1.messages[r1.messages.length - 1] as any).content)
}

async function compositeBackend() {
  console.log("\n=== 测试 2：CompositeBackend（混合路由） ===\n")

  const agent = createDeepAgent({
    model,
    systemPrompt: `你是一个智能文件管理助手。

你有两种存储可用：
1. 默认存储（临时）- 用于草稿和临时文件
2. /memories/ 路径（持久）- 用于需要长期保存的文件

请根据文件的重要性选择合适的存储位置。
请始终用中文回复。`,
    backend: (config) =>
      new CompositeBackend(new StateBackend(config), {
        "/memories/": new FilesystemBackend({
          rootDir: path.join(WORK_DIR, "persistent"),
          virtualMode: true,
        }),
      }),
  })

  const r1 = await agent.invoke({
    messages: [
      {
        role: "user",
        content:
          "请创建两个文件：1) /draft.md 写入临时草稿 2) /memories/important.md 写入重要笔记。然后列出两个目录的内容",
      },
    ],
  })
  console.log((r1.messages[r1.messages.length - 1] as any).content)
}

async function fileOperations() {
  console.log("\n=== 测试 3：高级文件操作 ===\n")

  const agent = createDeepAgent({
    model,
    systemPrompt: `你是一个高级文件操作助手。请展示 glob 和 grep 工具的使用。
请始终用中文回复。`,
    backend: new FilesystemBackend({
      rootDir: path.join(process.cwd(), "examples"),
      virtualMode: true,
    }),
  })

  const r1 = await agent.invoke({
    messages: [
      {
        role: "user",
        content:
          "使用 glob 查找 examples 目录下所有的 .ts 文件，然后用 grep 搜索包含 'createDeepAgent' 的文件",
      },
    ],
  })
  console.log((r1.messages[r1.messages.length - 1] as any).content)
}

async function main() {
  await filesystemBackend()
  await compositeBackend()
  await fileOperations()
}

main().catch(console.error)
