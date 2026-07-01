# 聊天消息渲染流程（ASCII）

> 入口：`chat-message-item.tsx`  
> 分类：`@/lib/chat/message-classifier.ts`  
> 工具合并：`merge-consecutive-tool-groups.ts`、`collapse-write-todos-blocks.ts`  
> 收起策略：`@/lib/chat/tool-collapse-policy.ts`  
> 流式解析：`@/lib/chat/langchain-stream-parser.ts` → `langchain-chat-transport.ts`

---

## 1. 总览：单条消息从 UIMessage 到 DOM

```
  UIMessage (ai SDK)
        |
        |  parts[] 由 langchain-stream-parser 产出 tool-* / text
        v
  +---------------------+
  |  ChatMessageItem    |
  |  useDeferredValue   |
  +---------------------+
        |
        |  classifyMessageParts(message, { includeFileChanges })
        v
  +---------------------+
  | ClassifiedBlock[]   |
  | (via block-registry)|  <-- 工具块按工具名分发解析
  | mergeRoutineTool    |  <-- 相邻 routine 单工具 tool-group 合并
  | Groups              |
  | collapseWriteTodos  |  <-- 同条消息多次 write_todos -> 单块 todo-plan
  +---------------------+
        |
        |  computeToolAutoCollapseMap(blocks, { isLastAssistantMessage, isTurnEnded })
        v
  +---------------------+
  | tool.key -> bool    |  Map: 是否应触发 shouldAutoCollapse
  +---------------------+
        |
        v
  +---------------------+
  | RenderClassified    |
  | Blocks              |  --> 按 block.kind 分发到 message-blocks/*
  +---------------------+
```

---

## 2. ChatMessageItem 内部

```
                    ChatMessageItem
                          |
          +---------------+---------------+
          |                               |
    role === assistant?              MessageContent
          |                               |
    [头像 + 显示名]                  space-y-1.5
                                          |
                          +---------------+---------------+
                          |                               |
              classifiedBlocks.length > 0          MessageResponse (空)
                          |
                          v
              RenderClassifiedBlocks
                + toolAutoCollapseMap
                + isLastAssistantMessage / isTurnEnded  (todo sticky 等)
                + commandMeta / mentionMeta / filesMeta
```

**Props 与收起 / 吸顶相关：**

| Prop | 作用 |
|------|------|
| `isLastAssistantMessage` | 是否为列表中最后一条 assistant（当前流式轮） |
| `isTurnEnded` | 本轮是否已结束（status ready/error）；末项工具据此延迟收起 |
| `sticky` on TodoPlanBlock | `isLastAssistantMessage && !isTurnEnded` 时任务卡吸顶 |

---

## 3. 分类器：classifyMessageParts

```
  message.parts[]  (按流式顺序)
        |
        v
  +------------------+
  | 有任意 tool-* ?  |
  +------------------+
     |              |
    否             是
     |              |
     v              v
 [纯文本路径]   [工具路径：遍历 parts]
     |              |
     |              +-- text, i <= lastToolIndex  --> thinking
     |              +-- text, i >  lastToolIndex  --> final-response
     |              +-- tool via block-registry   --> 业务定制块 (如 plan-generated)
     |              +-- tool 路径含 /skills/           --> skill-exploration (合并)
     |              +-- 其它 tool-*                    --> tool-group (单 tool/块)
     |              |
     v              v
  blocks[] -----> mergeConsecutiveToolGroups()
                      |
                      v
                collapseWriteTodosBlocks()
                      |
                      v
                    返回
```

### 3.1 技能探索 vs 普通工具

```
  tool part 到达
        |
        v
  isSkillToolCall(input, toolName) ?
  (read/ls/glob/grep 且 path 以 /skills/ 或 /skills-draft/ 开头)
        |
   yes--+--no--> pushSingleTool --> tool-group
        |
        v
  累积到 skillExploreItems[]
        |
  遇到非技能 tool 或 final-response
        |
        v
  flushSkillExplore --> skill-exploration 块 (默认折叠)
```

### 3.2 合并相邻 routine 工具

```
  blocks[] 扫描
        |
        v
  +------------------------------------------+
  | 相邻 tool-group 且 tools.length===1     |
  | 且 toolName in ROUTINE_TOOL_NAMES       |
  |   (shell_execute, execute, grep, glob, ls)|
  +------------------------------------------+
        |
        v
  合并为一个 tool-group { tools: [...], summary: summarizeToolGroup }
        |
  不合并：skill-exploration, plan-generated, todo-plan,
          read_file / write_file / edit_file, 已是多 tool 的块
```

### 3.3 合并同条消息内 write_todos（todo-plan）

```
  扫描所有「单工具 + write_todos」的 tool-group 索引
        |
        v
  +------------------------------------------+
  | 至少一处 getTodos() 非空？               |
  +------------------------------------------+
     | 否                          | 是
     v                             v
  不合并，保留 tool-group      在 firstIndex 插入 todo-plan
  (ToolActivityLine 紧凑行)     key = 首次块的 key
                              tool/todos = 最后一次 write_todos
                              其余 write_todos 块丢弃
        |
        v
  { kind: "todo-plan", tool, todos }
```

**流式更新示例：**

```
  parts 顺序:  write_todos(1/4) -> text -> write_todos(2/4) -> ...
  blocks 渲染:  [todo-plan @ 首次位置，内容始终为最新 2/4]
                (不会出现第二张任务规划卡)
```

---

## 4. RenderClassifiedBlocks：块类型 → 组件

```
  for each block in blocks
        |
        +-- tool-group ------------> ToolGroupBlock
        +-- todo-plan -------------> TodoPlanBlock (sticky 可选)
        +-- plan-generated --------> PlanGeneratedCard
        +-- file-changes ----------> FileChangeCards
        +-- error -----------------> 内联错误卡片
        +-- skill-exploration -----> SkillExplorationBlock
        +-- summarization-checkpoint -> SummarizationCheckpointBlock
        +-- thinking --------------> ThinkingBlock
        +-- final-response --------> MessageMetaBadges + MessageResponse
```

---

## 5. ToolGroupBlock 分支

```
                    ToolGroupBlock
                          |
              block.tools.length === 1 ?
                    /              \
                  是                否 (多工具，已合并的 routine 组)
                  /                    \
         needsFullToolRow?          RoutineToolActivityBlock
            /         \                  |
          是          否                 +-- 折叠头: block.summary + chevron
           |           |                 +-- 展开: ToolActivityLine × N
    ToolActionRow   ToolActivityLine
    (仅 edit_file
     含 diff)
```

> `write_todos` 含列表时不再走 ToolActionRow，由分类阶段的 `todo-plan` 统一展示。

### 5.1 单行布局（ToolActivityLine / ToolActionRow 标题栏）

```
  +--------+--------------------------------+--------+
  | 类型   | label [chevron]              | 状态   |
  | 图标   | (chevron 在 label 后)        | spin/勾/叉 |
  +--------+--------------------------------+--------+
  (不展示 toolName monospace 文案)

  Chevron：展开时常驻；收起时 hover/focus 显示
```

### 5.2 工具详情：ToolDetailPanel + ToolOutputViewport

```
  ToolDetailPanel
        |
        +-- preliminary / resultText (stdout)
        |       --> ToolOutputViewport
        |             StickToBottom (独立实例，非会话级)
        |             VirtualizedStdoutLines (>=80 行虚拟化)
        |             流式底部雾化 / 收起溢出雾
        |
        +-- displayContent (write_file / command 预览)
        |       --> ToolOutputViewport (children: CodeHighlight)
        |
        +-- edit_file --> DiffViewer (不虚拟化)
```

---

## 6. TodoPlanBlock

```
  TodoPlanBlock
        |
        +-- header: 任务规划 (completed/total) + 状态图标
        +-- TodoListBlock (列表，可展开「还有 N 项」)
        |
        sticky === true  (当前轮流式中)
        --> sticky top-0 z-20 + 半透明背景
        (滚动祖先: Conversation overflow-y-auto)
```

---

## 7. ToolRow 延迟收起策略

```
  展平本条消息内：
    tool-group.tools[]  +  todo-plan.tool  --> allTools[0..n-1]

  for each tool at index i:

    未完成 (running / preliminary)
         --> shouldAutoCollapse = false

    非最后一条 assistant 消息 (历史)
         --> shouldAutoCollapse = true

    当前轮且 i < n-1  (后面还有工具)
         --> shouldAutoCollapse = true

    当前轮且 i === n-1  (本条消息最后一个工具)
         --> shouldAutoCollapse = isTurnEnded
```

```
  时间线示例（当前轮）:

  tool A 完成 -----> 不收起 (map[A]=false)
  tool B 出现 -----> A 收起 (map[A]=true)
  tool B 完成 -----> B 仍展开直到 isTurnEnded
  回合结束 --------> B 收起 (map[B]=true)
```

---

## 8. 流式解析 → UI（与 langchain-stream-parser 衔接）

```
  SSE (LangGraph)
        |
        v
  parseLangChainPayloadToChunks
        |
        +-- tool-input-*     (write_todos / shell_execute 等参数流)
        +-- tool-output-*    (含 preliminary stdout)
        +-- text-*           (thinking / final-response)
        |
        v
  UIMessage.parts
        |
        v
  classifyMessageParts + merge + collapseWriteTodos
        |
        v
  TodoPlanBlock / ToolActivityLine / ToolDetailPanel ...
```

解析器禁止无 id/name 的 `tool-input-start`（避免 `unknown_tool` 幽灵行），
详见 `langchain-stream-parser.ts` 文件末尾 ASCII 注释。

---

## 9. 相关文件索引

```
  messages/
    chat-message-item.tsx     .......... 本目录入口
    MESSAGE_RENDER_FLOW.md    .......... 本文档

  message-blocks/
    tool-group-block.tsx      .......... tool-group 分发
    tool-activity-line.tsx    .......... 紧凑工具行
    tool-action-row.tsx       .......... 富交互行 (edit diff 等)
    tool-detail-panel.tsx     .......... 命令/输出 / CodeHighlight
    tool-output-viewport.tsx  .......... stdout/CodeHighlight 滚动视口
    virtualized-stdout-lines.tsx ....... stdout 按行虚拟化 (>=80 行)
    todo-plan-block.tsx       .......... 合并后的任务规划卡
    todo-list-block.tsx       .......... 任务列表 UI
    skill-exploration-block.tsx

  lib/chat/
    message-classifier.ts
    merge-consecutive-tool-groups.ts
    collapse-write-todos-blocks.ts
    tool-collapse-policy.ts
    tool-label-registry.ts
    tool-summarizer.ts
    langchain-stream-parser.ts
    langchain-chat-transport.ts
```

---

## 10. 调用方

```
  ChatView / CuratorView
        |
        v
  ChatMessageItem
    isLastAssistantMessage = (index === last assistant)
    isTurnEnded = status in { ready, error }
```
