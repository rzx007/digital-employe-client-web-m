# DeepAgents 深度使用报告

> 基于 LangChain 官方文档的全面研究，结合 simple-agents 项目实际代码
>
> 报告日期：2026-03-28

---

## 目录

1. [概述与定位](#1-概述与定位)
2. [核心架构](#2-核心架构)
3. [核心能力详解](#3-核心能力详解)
4. [模型支持与配置](#4-模型支持与配置)
5. [Backend（文件系统后端）](#5-backend文件系统后端)
6. [Subagents（子代理）](#6-subagents子代理)
7. [Skills（技能系统）](#7-skills技能系统)
8. [Memory（记忆系统）](#8-memory记忆系统)
9. [Human-in-the-Loop（人机协作）](#9-human-in-the-loop人机协作)
10. [Context Engineering（上下文工程）](#10-context-engineering上下文工程)
11. [Middleware（中间件）](#11-middleware中间件)
12. [Sandboxes（沙箱执行）](#12-sandboxes沙箱执行)
13. [Structured Output（结构化输出）](#13-structured-output结构化输出)
14. [CLI 工具](#14-cli-工具)
15. [实际场景分析](#15-实际场景分析)
16. [最佳实践与踩坑指南](#16-最佳实践与踩坑指南)
17. [示例代码索引](#17-示例代码索引)

---

## 1. 概述与定位

### 1.1 什么是 DeepAgents

`deepagents` 是 LangChain 团队开源的独立 npm 包，构建在 LangChain 核心构建块之上，使用 LangGraph 的工具链来运行代理。

**核心定位：** 一个 "Agent Harness"（代理线束）——它与其它代理框架共享相同的工具调用循环，但内置了规划、文件系统、子代理派生和长期记忆等能力。

### 1.2 何时使用 DeepAgents

| 适合使用 DeepAgents                | 不适合使用               |
| ---------------------------------- | ------------------------ |
| 处理需要规划和分解的复杂多步骤任务 | 简单的单步工具调用       |
| 需要通过文件系统管理大量上下文     | 不需要持久化的轻量对话   |
| 在隔离环境（沙箱）中执行代码       | 对安全性无要求的原型验证 |
| 将工作委派给专业化的子代理         | 不需要上下文隔离的场景   |
| 跨对话/线程持久化记忆              | 简单的问答系统           |

### 1.3 与 LangChain/LangGraph 的关系

```
LangGraph（运行时引擎）
  └── deepagents（代理线束，内置能力）
        ├── 规划与任务分解
        ├── 文件系统管理
        ├── 子代理派生
        └── 长期记忆
```

### 1.4 包结构

DeepAgents 包含两个主要部分：

- **Deep Agents SDK**: 用于构建能处理任何任务的代理的包
- **Deep Agents CLI**: 基于 SDK 构建的终端编程代理

---

## 2. 核心架构

### 2.1 createDeepAgent API

核心入口函数，接受以下配置：

```typescript
const agent = createDeepAgent({
  name?: string,                    // 代理名称
  model?: BaseLanguageModel | string, // LLM 模型
  tools?: TTools | StructuredTool[],  // 自定义工具
  systemPrompt?: string | SystemMessage, // 系统提示词
  backend?: BackendProtocol | BackendFactory, // 文件系统后端
  subagents?: SubAgent[],          // 子代理列表
  skills?: string[],               // 技能目录路径
  memory?: string[],               // 记忆文件路径
  middleware?: Middleware[],        // 自定义中间件
  interruptOn?: Record<string, ...>, // 人机协作配置
  checkpointer?: Checkpointer,      // 检查点（状态持久化）
  store?: BaseStore,               // 长期存储
  responseFormat?: ZodSchema,       // 结构化输出 schema
  contextSchema?: ZodSchema,       // 运行时上下文 schema
})
```

### 2.2 调用方式

```typescript
// 同步调用
const result = await agent.invoke(
  { messages: [{ role: "user", content: "Hello" }] },
  { configurable: { thread_id: "thread-123" } }
)

// 流式调用
const stream = agent.streamEvents(
  { messages: [{ role: "user", content: "Hello" }] },
  config
)
for await (const event of stream) {
  /* ... */
}
```

### 2.3 返回结构

```typescript
result = {
  messages: [...],      // 完整的消息历史
  todos: [...],         // 任务列表状态
  structuredResponse: {...}, // 结构化输出（如果配置了 responseFormat）
}
```

---

## 3. 核心能力详解

### 3.1 规划与任务分解

内置 `write_todos` 工具，代理可以：

- 将复杂任务分解为离散步骤
- 跟踪进度（`pending` → `in_progress` → `completed`）
- 根据新信息动态调整计划

### 3.2 上下文管理（虚拟文件系统）

| 工具         | 功能                                            |
| ------------ | ----------------------------------------------- |
| `ls`         | 列出目录内容，包含元数据（大小、修改时间）      |
| `read_file`  | 读取文件内容，支持偏移/限制，支持图片（多模态） |
| `write_file` | 创建新文件                                      |
| `edit_file`  | 精确字符串替换编辑文件（支持全局替换）          |
| `glob`       | 按模式查找文件（如 `**/*.py`）                  |
| `grep`       | 搜索文件内容，支持多种输出模式                  |
| `execute`    | 运行 shell 命令（仅沙箱后端可用）               |

### 3.3 子代理派生

通过内置 `task` 工具，主代理可以派生子代理来：

- **上下文隔离** — 子代理工作不污染主代理上下文
- **并行执行** — 多个子代理可同时运行
- **专业化** — 子代理可有不同的工具/配置
- **Token 效率** — 大型子任务上下文被压缩为单个结果

### 3.4 长期记忆

通过 LangGraph Memory Store 实现：

- 跨线程和对话持久化
- 使用 `AGENTS.md` 文件提供持久上下文
- 自动学习用户偏好和模式

---

## 4. 模型支持与配置

### 4.1 支持的提供商

| 提供商    | 推荐模型                                                           |
| --------- | ------------------------------------------------------------------ |
| Anthropic | claude-opus-4-6, claude-sonnet-4-6, claude-haiku-4-5               |
| OpenAI    | gpt-5.4, gpt-4o, gpt-4.1, o4-mini                                  |
| Google    | gemini-3-flash-preview, gemini-3.1-pro-preview                     |
| 开源模型  | GLM-5, Kimi-K2.5, qwen3.5-397B（通过 OpenRouter/Fireworks/Ollama） |

### 4.2 模型配置方式

```typescript
// 方式1：字符串（最简单）
createDeepAgent({ model: "anthropic:claude-sonnet-4-6" })

// 方式2：initChatModel
const model = await initChatModel("claude-sonnet-4-6", { maxTokens: 16000 })
createDeepAgent({ model })

// 方式3：模型类实例
const model = new ChatOpenAI({ model: "gpt-4o", temperature: 0 })
createDeepAgent({ model })

// 方式4：运行时动态切换（通过中间件）
// 详见 Middleware 章节
```

### 4.3 连接弹性

LangChain 聊天模型自动以指数退避重试失败的 API 请求：

- 默认重试 6 次（网络错误、429 限流、5xx 服务器错误）
- 401（未授权）和 404 不重试
- 可通过 `maxRetries` 和 `timeout` 调整

---

## 5. Backend（文件系统后端）

### 5.1 后端类型对比

| 后端                     | 持久性           | 适用场景                           |
| ------------------------ | ---------------- | ---------------------------------- |
| **StateBackend**（默认） | 单线程内临时     | 代理的草稿工作空间、自动上下文卸载 |
| **FilesystemBackend**    | 持久到本地磁盘   | 本地项目、CI/CD                    |
| **StoreBackend**         | 跨线程持久       | 长期记忆、生产部署                 |
| **CompositeBackend**     | 混合（路由规则） | 需要临时+持久混合存储              |
| **LocalShellBackend**    | 本地磁盘+Shell   | 本地开发工具（需极端谨慎）         |
| **SandboxBackend**       | 沙箱内临时       | 安全的代码执行环境                 |

### 5.2 CompositeBackend 路由

```typescript
const compositeBackend = (rt) => new CompositeBackend(
  new StateBackend(rt),  // 默认：临时存储
  {
    "/memories/": new StoreBackend(rt),     // 持久存储
    "/workspace/": new FilesystemBackend({...}), // 本地磁盘
  }
)
```

### 5.3 自定义后端协议

需要实现 `BackendProtocol`：

```typescript
interface BackendProtocol {
  ls_info(path: string): FileInfo[]
  read(file_path: string, offset?: number, limit?: number): string
  grep_raw(pattern: string, path?: string, glob?: string): GrepMatch[] | string
  glob_info(pattern: string, path?: string): FileInfo[]
  write(file_path: string, content: string): WriteResult
  edit(
    file_path: string,
    old_string: string,
    new_string: string,
    replace_all?: boolean
  ): EditResult
}
```

---

## 6. Subagents（子代理）

### 6.1 配置规范

| 字段            | 类型     | 说明                                   |
| --------------- | -------- | -------------------------------------- |
| `name`          | `string` | 必填，唯一标识符                       |
| `description`   | `string` | 必填，描述（主代理据此决定何时委派）   |
| `system_prompt` | `string` | 必填，自定义子代理有自己的提示词       |
| `tools`         | `list`   | 必填，自定义子代理有自己的工具集       |
| `model`         | `string` | 可选，覆盖主代理模型                   |
| `middleware`    | `list`   | 可选，自定义中间件                     |
| `interrupt_on`  | `dict`   | 可选，人机协作配置（继承主代理默认值） |
| `skills`        | `list`   | 可选，子代理专属技能（不继承主代理）   |

### 6.2 通用子代理

始终可用的 `general-purpose` 子代理：

- 与主代理共享系统提示词、工具、模型
- 自动继承主代理的 skills
- 可通过定义同名子代理来覆盖

### 6.3 CompiledSubAgent

对于复杂工作流，可以使用预编译的 LangGraph 图：

```typescript
const customGraph = createAgent({ model, tools, prompt: "..." })
const subagent: CompiledSubAgent = {
  name: "custom",
  description: "...",
  runnable: customGraph, // 必须先 compile()
}
```

### 6.4 上下文传播

- 父代理的运行时上下文自动传播到所有子代理
- 支持命名空间键实现子代理专属配置：`"researcher:maxDepth": 3`
- 通过 `config.metadata?.lc_agent_name` 识别调用工具的代理

---

## 7. Skills（技能系统）

### 7.1 核心概念

Skills 遵循 [Agent Skills 标准](https://agentskills.io/)，使用**渐进式披露**（progressive disclosure）：

- 启动时只读取 `SKILL.md` 的 frontmatter（名称+描述）
- 代理判断相关时才加载完整内容

### 7.2 SKILL.md 结构

```markdown
---
name: skill-name
description: 描述（最多1024字符）
license: MIT
metadata:
  author: your-name
  version: "1.0"
allowed-tools: tool1, tool2
---

# 技能标题

## 概述

...

## 指令

1. 步骤一
2. 步骤二
```

### 7.3 Skills vs Memory 对比

| 维度         | Skills                   | Memory (AGENTS.md)     |
| ------------ | ------------------------ | ---------------------- |
| **目的**     | 按需加载的能力           | 始终加载的持久上下文   |
| **加载方式** | 代理判断相关性后加载     | 每次启动注入系统提示词 |
| **格式**     | `SKILL.md` 在命名目录中  | `AGENTS.md` 文件       |
| **覆盖规则** | 后加载的覆盖先加载的     | 用户级+项目级合并      |
| **适用场景** | 大量上下文的任务特定指令 | 始终相关的项目约定     |

---

## 8. Memory（记忆系统）

### 8.1 AGENTS.md 文件

- **全局级**：`~/.deepagents/<agent_name>/AGENTS.md` — 每次会话加载
- **项目级**：`.deepagents/AGENTS.md` — 在 git 项目根目录中加载

### 8.2 长期记忆配置

```typescript
const agent = createDeepAgent({
  store: new InMemoryStore(),
  backend: (config) =>
    new CompositeBackend(
      new StateBackend(config), // 临时存储
      { "/memories/": new StoreBackend(config) } // 持久存储
    ),
  systemPrompt: `当用户告诉你偏好时，保存到 /memories/user_preferences.txt`,
})
```

### 8.3 跨线程访问

```typescript
// 线程1：写入长期记忆
await agent.invoke({ messages: [...] }, { configurable: { thread_id: "t1" } })

// 线程2：读取长期记忆（不同对话！）
await agent.invoke({ messages: [...] }, { configurable: { thread_id: "t2" } })
```

### 8.4 自我改进

代理可以基于用户反馈更新自己的指令文件：

```typescript
systemPrompt: `读取 /memories/instructions.txt 了解用户偏好。
当用户提供反馈时，使用 edit_file 工具更新该文件。`
```

---

## 9. Human-in-the-Loop（人机协作）

### 9.1 基本配置

```typescript
const agent = createDeepAgent({
  interruptOn: {
    delete_file: true, // 默认：批准/编辑/拒绝
    read_file: false, // 不需要中断
    send_email: { allowedDecisions: ["approve", "reject"] }, // 不允许编辑
  },
  checkpointer: new MemorySaver(), // 必须提供！
})
```

### 9.2 决策类型

| 决策        | 说明               |
| ----------- | ------------------ |
| `"approve"` | 按代理原始参数执行 |
| `"edit"`    | 修改参数后执行     |
| `"reject"`  | 跳过此工具调用     |

### 9.3 处理中断

```typescript
let result = await agent.invoke({ messages: [...] }, config)

if (result.__interrupt__) {
  // 展示待审批操作给用户
  // 获取用户决策
  const decisions = [{ type: "approve" }]

  // 恢复执行
  result = await agent.invoke(
    new Command({ resume: { decisions } }),
    config  // 必须使用相同 config！
  )
}
```

### 9.4 子代理中断

- 子代理可以有自己的 `interruptOn` 配置，覆盖主代理设置
- 子代理工具可以直接调用 `interrupt()` 函数请求审批

---

## 10. Context Engineering（上下文工程）

### 10.1 上下文类型

| 类型             | 控制范围               | 作用域                   |
| ---------------- | ---------------------- | ------------------------ |
| **输入上下文**   | 系统提示词、记忆、技能 | 静态，每次运行应用       |
| **运行时上下文** | 用户元数据、API密钥    | 每次调用，传播到子代理   |
| **上下文压缩**   | 自动卸载和摘要         | 自动触发，接近窗口限制时 |
| **上下文隔离**   | 子代理隔离繁重工作     | 每个子代理委派时         |
| **长期记忆**     | 虚拟文件系统持久化     | 跨对话持久               |

### 10.2 自动上下文压缩

**卸载（Offloading）：**

- 工具调用输入/结果超过 20,000 token 时自动触发
- 大内容保存到文件系统，替换为文件路径引用 + 前10行预览

**摘要（Summarization）：**

- 上下文达到模型窗口 85% 时触发
- LLM 生成结构化摘要替换完整历史
- 原始消息保存到文件系统以备检索

### 10.3 系统提示词组装顺序

1. 自定义 `system_prompt`
2. 基础代理提示词
3. 待办事项提示词
4. 记忆提示词
5. 技能提示词
6. 虚拟文件系统提示词
7. 子代理提示词
8. 自定义中间件提示词
9. 人机协作提示词

---

## 11. Middleware（中间件）

### 11.1 默认中间件

| 中间件                             | 功能                     |
| ---------------------------------- | ------------------------ |
| `TodoListMiddleware`               | 跟踪和管理待办事项列表   |
| `FilesystemMiddleware`             | 处理文件系统操作         |
| `SubAgentMiddleware`               | 派生和协调子代理         |
| `SummarizationMiddleware`          | 压缩消息历史             |
| `AnthropicPromptCachingMiddleware` | Anthropic 模型的缓存优化 |
| `PatchToolCallsMiddleware`         | 自动修复中断的工具调用   |

### 11.2 自定义中间件

```typescript
const logMiddleware = createMiddleware({
  name: "LogToolCalls",
  wrapToolCall: async (request, handler) => {
    console.log(`[调用] ${request.toolCall.name}`)
    const result = await handler(request)
    console.log(`[完成] ${request.toolCall.name}`)
    return result
  },
})
```

**重要警告：** 不要在中间件中使用可变状态（如 `self.x += 1`），会导致并发竞态条件。使用图状态代替。

---

## 12. Sandboxes（沙箱执行）

### 12.1 支持的沙箱提供商

| 提供商       | 特点                               |
| ------------ | ---------------------------------- |
| **Modal**    | ML/AI 工作负载、GPU 访问           |
| **Daytona**  | TypeScript/Python 开发、快速冷启动 |
| **Deno**     | Deno/JavaScript 工作负载、微虚拟机 |
| **Node VFS** | 本地开发、测试，无需云端           |

### 12.2 两种集成模式

1. **Agent in Sandbox** — 代理运行在沙箱内，通过网络通信
2. **Sandbox as Tool**（推荐） — 代理在本地运行，代码执行在远程沙箱

### 12.3 安全注意事项

- **绝不在沙箱中放置密钥** — 代理可被上下文注入攻击读取
- 推荐将密钥保留在沙箱外的工具中
- 审查沙箱输出后再在应用中使用
- 不需要时阻止沙箱网络访问

---

## 13. Structured Output（结构化输出）

```typescript
const weatherSchema = z.object({
  location: z.string(),
  temperature: z.number(),
  condition: z.string(),
  humidity: z.number(),
  windSpeed: z.number(),
  forecast: z.string(),
})

const agent = createDeepAgent({
  responseFormat: weatherSchema,
  tools: [internetSearch],
})

const result = await agent.invoke({
  messages: [{ role: "user", content: "What's the weather?" }],
})

console.log(result.structuredResponse)
// { location: "SF", temperature: 18.3, ... }
```

---

## 14. CLI 工具

### 14.1 安装

```bash
curl -LsSf https://raw.githubusercontent.com/langchain-ai/deepagents/refs/heads/main/libs/cli/scripts/install.sh | bash
```

### 14.2 内置工具（14个）

| 工具                                      | 功能       | 需要审批 |
| ----------------------------------------- | ---------- | -------- |
| `ls`, `read_file`, `glob`, `grep`         | 文件操作   | 否       |
| `write_file`, `edit_file`                 | 文件修改   | 是       |
| `execute`                                 | Shell 命令 | 是       |
| `http_request`, `web_search`, `fetch_url` | 网络       | 混合     |
| `task`                                    | 子代理委派 | 是       |
| `ask_user`                                | 询问用户   | 否       |
| `compact_conversation`                    | 上下文压缩 | 混合     |
| `write_todos`                             | 任务管理   | 否       |

### 14.3 运行模式

```bash
deepagents                          # 交互模式
deepagents -n "任务描述"            # 非交互模式
echo "内容" | deepagents            # 管道输入
deepagents --sandbox daytona        # 使用沙箱
deepagents --model anthropic:claude-opus-4-5  # 指定模型
```

### 14.4 斜杠命令

`/model` 切换模型 | `/remember` 更新记忆 | `/offload` 释放上下文 | `/tokens` 查看 token 用量 | `/clear` 清除历史 | `/threads` 浏览会话 | `/trace` 打开 LangSmith

---

## 15. 实际场景分析

### 15.1 已有项目 simple-agents 分析

当前项目使用了 DeepAgents 的以下能力：

| 能力              | 使用状态  | 说明                             |
| ----------------- | --------- | -------------------------------- |
| 自定义模型        | ✅ 已使用 | GLM-4.7 通过 ChatOpenAI 兼容接口 |
| FilesystemBackend | ✅ 已使用 | 虚拟模式，限制了工作目录         |
| 自定义系统提示词  | ✅ 已使用 | 中文文件管理助手                 |
| 子代理            | ❌ 未使用 | 仅在系统提示词中提及 task 工具   |
| Skills            | ❌ 未使用 | —                                |
| Memory            | ❌ 未使用 | —                                |
| Human-in-the-Loop | ❌ 未使用 | —                                |
| 结构化输出        | ❌ 未使用 | —                                |
| Checkpointer      | ❌ 未使用 | thread_id 传入但无实际持久化     |
| Streaming         | ✅ 已使用 | 两个流式端点 + 非流式端点        |

### 15.2 可扩展方向

1. **添加 Checkpointer** — 实现真正的多轮对话持久化
2. **添加子代理** — 文件分析、代码生成等专业化子代理
3. **添加 Memory** — 学习用户偏好和项目约定
4. **添加 Skills** — 针对特定任务的技能包
5. **添加结构化输出** — API 返回结构化数据

---

## 16. 最佳实践与踩坑指南

### 16.1 最佳实践

1. **子代理描述要具体** — 主代理依赖描述决定委派对象
2. **子代理返回简洁结果** — 指示子代理返回摘要而非原始数据
3. **最小化工具集** — 只给子代理需要的工具
4. **使用文件系统处理大数据** — 让代理将大数据写入文件再处理
5. **记录记忆结构** — 在系统提示词中说明 `/memories/` 的组织方式
6. **始终使用检查点** — 人机协作和状态持久化必需

### 16.2 常见陷阱

| 陷阱                         | 解决方案                                   |
| ---------------------------- | ------------------------------------------ |
| 子代理不被调用               | 写更具体的描述，在系统提示词中明确要求委派 |
| 上下文仍然膨胀               | 指示子代理返回简洁结果，使用文件系统       |
| 选错子代理                   | 在描述中明确区分不同子代理的适用场景       |
| 中间件竞态条件               | 不使用可变状态，使用图状态                 |
| 沙箱中密钥泄露               | 密钥保留在沙箱外工具中                     |
| 非交互模式下 Shell 被禁用    | 使用 `-S` 参数白名单或 `recommended`       |
| 恢复中断时使用不同 thread_id | 必须使用相同的 config 对象                 |

---

## 17. 示例代码索引

所有示例位于 `examples/` 目录下：

| 文件                             | 难度 | 涵盖内容                           |
| -------------------------------- | ---- | ---------------------------------- |
| `01-basic-agent.ts`              | 入门 | 最简单的 DeepAgent 创建与调用      |
| `02-custom-tools.ts`             | 入门 | 添加自定义工具（天气查询、计算器） |
| `03-streaming.ts`                | 入门 | 流式输出的完整实现                 |
| `04-subagents.ts`                | 进阶 | 子代理委派与专业化分工             |
| `05-backend-types.ts`            | 进阶 | 各种 Backend 类型的使用与对比      |
| `06-memory-skills.ts`            | 进阶 | 记忆系统与技能系统                 |
| `07-human-in-the-loop.ts`        | 进阶 | 人机协作审批流程                   |
| `08-structured-output.ts`        | 进阶 | 结构化输出与数据验证               |
| `09-context-engineering.ts`      | 高级 | 上下文工程：压缩、隔离、长期记忆   |
| `10-realworld-research-agent.ts` | 高级 | 完整的研究代理实战案例             |
