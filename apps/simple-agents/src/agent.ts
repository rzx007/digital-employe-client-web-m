/**
 * Agent 模块 - DeepAgents 代理配置与实例
 *
 * 本模块负责：
 * 1. 初始化 AI 模型 (GLM-4.7)
 * 2. 定义代理系统提示词
 * 3. 创建 DeepAgent 实例
 * 4. 管理会话目录（按会话隔离文件系统）
 *
 * 核心架构：
 * - 使用 LangChain 的 createDeepAgent 创建代理
 * - 采用 BackendFactory 模式，根据会话 ID 动态创建文件系统后端
 * - 每个会话有独立的虚拟文件系统，互不干扰
 */

import "dotenv/config"
import { createDeepAgent, FilesystemBackend } from "deepagents"
import { ChatOpenAI } from "@langchain/openai"
import path from "node:path"
import fs from "node:fs"
import { DATA_DIR } from "./db"

/**
 * AI 模型配置
 *
 * 使用 GLM-4.7 模型，通过 OpenAI 兼容 API 调用
 * - temperature=0 保证输出稳定（不随机）
 * - 支持通过环境变量配置 API 密钥和基础 URL
 */
const model = new ChatOpenAI({
  model: "glm-4.7",
  openAIApiKey: process.env.OPENAI_API_KEY || process.env.GLM_API_KEY,
  configuration: {
    baseURL: process.env.GLM_BASE_URL,
  },
  temperature: 0,
})

/**
 * 系统提示词 - 定义代理的行为和能力
 *
 * 这段提示词告诉代理：
 * - 它是一个专业 AI 助手
 * - 它可以执行文件操作和搜索
 * - 可以使用哪些工具
 * - 使用中文回复
 */
const systemPrompt = `你是一个专业的 AI 助手。你可以读取、创建和编辑文件，也可以使用 ls、glob、grep 等工具浏览和搜索文件。

可用工具说明：
- ls: 列出目录内容
- read_file: 读取文件内容
- write_file: 创建或覆盖文件
- edit_file: 编辑文件（精确字符串替换）
- glob: 按模式查找文件
- grep: 搜索文件内容
- task: 将复杂任务委派给子代理执行
- write_todos: 管理任务列表

请始终用中文回复用户。`

/**
 * 获取会话目录路径
 *
 * @param threadId 会话唯一标识符
 * @returns 会话对应的目录路径
 *
 * 功能：
 * - 根据会话 ID 创建独立的工作目录
 * - 如果目录不存在，自动创建
 * - 会话目录结构：data/workspace/{threadId}/
 */
function getSessionDir(threadId: string): string {
  const sessionDir = path.join(DATA_DIR, "workspace", threadId)
  if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true })
  }
  return sessionDir
}

/**
 * DeepAgent 代理实例
 *
 * 配置要点：
 * 1. model: 使用 GLM-4.7 模型
 * 2. systemPrompt: 代理的行为定义
 * 3. backend: BackendFactory 函数，为每个会话提供独立的文件系统
 *    - 根据 thread_id 动态创建目录
 *    - virtualMode=true 限制在虚拟文件系统内操作
 *    - 保证不同会话的文件操作完全隔离
 */
const agent = createDeepAgent({
  model,
  systemPrompt,
  backend: (runtime: any) => {
    // 从配置中获取会话 ID，如果不存在则使用默认值
    const threadId = runtime.configurable?.thread_id || "default"
    const dir = getSessionDir(threadId)
    // 返回新的 FilesystemBackend 实例，限制在该会话目录下
    return new FilesystemBackend({ rootDir: dir, virtualMode: true })
  },
})

// 导出代理实例和会话目录获取函数
export { agent, getSessionDir }
