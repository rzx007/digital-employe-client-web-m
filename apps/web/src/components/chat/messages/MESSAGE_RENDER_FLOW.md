# 聊天消息渲染流程（ASCII）

> 入口：`chat-message-item.tsx`  
> 分类：`@/lib/chat/message-classifier.ts`  
> 工具合并：`@/lib/chat/merge-routine-tool-groups.ts`  
> 收起策略：`@/lib/chat/tool-collapse-policy.ts`

---

## 1. 总览：单条消息从 UIMessage 到 DOM

```
  UIMessage (ai SDK)
        |
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
  | mergeRoutineTool    |  <-- 相邻 routine 工具合并
  | Groups (后处理)     |
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
    [头像 + 显示名]                  space-y-3
                                          |
                          +---------------+---------------+
                          |                               |
              classifiedBlocks.length > 0          MessageResponse (空)
                          |
                          v
              RenderClassifiedBlocks
                + toolAutoCollapseMap
                + commandMeta / mentionMeta / filesMeta
```

**Props 与收起相关：**

| Prop | 作用 |
|------|------|
| `isLastAssistantMessage` | 是否为列表中最后一条 assistant（当前流式轮） |
| `isTurnEnded` | 本轮是否已结束（status ready/error）；末项工具据此延迟收起 |

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
     |              +-- tool create_orchestration_plan --> plan-generated
     |              +-- tool 路径含 /skills/           --> skill-exploration (合并)
     |              +-- 其它 tool-*                    --> tool-group (单 tool/块)
     |              |
     v              v
  ClassifiedBlock[] -----> mergeRoutineToolGroups() -----> 返回
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
  不合并：skill-exploration, plan-generated, 业务工具,
          read_file / write_file / edit_file, 已是多 tool 的块
```

---

## 4. RenderClassifiedBlocks：块类型 → 组件

```
  for each block in blocks
        |
        +-- tool-group ------------> ToolGroupBlock
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
          是          否                 +-- 折叠头: block.summary
           |           |                 +-- 展开: ToolActivityLine × N
    ToolActionRow   ToolActivityLine
    (write_todos    (紧凑行:
     含 todos,      [类型图标][label][状态])
     edit_file
     含 diff)
```

### 5.1 单行布局（ToolActivityLine / ToolActionRow 标题栏）

```
  +--------+----------------------------+--------+
  | 类型   | summary.label (语义标题)   | 状态   |
  | 图标   | intent / registry / 路径   | spin/勾/叉 |
  +--------+----------------------------+--------+
  (不展示 toolName  monospace 文案)
```

---

## 6. ToolRow 延迟收起策略

```
  展平本条消息内所有 tool-group.tools[] --> allTools[0..n-1]

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

  tool A 完成 -----> 不收起 (map[A]=false, 非末项或回合未结束)
  tool B 出现 -----> A 收起 (map[A]=true)
  tool B 完成 -----> B 仍展开直到 isTurnEnded
  回合结束 --------> B 收起 (map[B]=true)
```

---

## 7. 相关文件索引

```
  messages/
    chat-message-item.tsx     .......... 本目录入口
    MESSAGE_RENDER_FLOW.md    .......... 本文档

  message-blocks/
    tool-group-block.tsx      .......... tool-group 分发
    tool-activity-line.tsx    .......... 紧凑工具行
    tool-action-row.tsx       .......... 富交互行 (todos/diff)
    tool-detail-panel.tsx     .......... 命令/输出/ diff 详情
    skill-exploration-block.tsx

  lib/chat/
    message-classifier.ts
    merge-routine-tool-groups.ts
    tool-collapse-policy.ts
    tool-label-registry.ts    .......... ROUTINE_TOOL_NAMES / 语义标题
    tool-summarizer.ts
```

---

## 8. 调用方

```
  ChatView / CuratorView
        |
        v
  ChatMessageItem
    isLastAssistantMessage = (index === last assistant)
    isTurnEnded = status in { ready, error }
```
