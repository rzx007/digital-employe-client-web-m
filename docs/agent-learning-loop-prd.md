# Agent 学习闭环 PRD — P0

> 版本：v1.0 | 日期：2026-05-17

## 1. 问题陈述

### 1.1 现状

当前数字员工 agent 已具备基本能力：加载外部技能、对话、执行任务、持久化会话。但 **每次对话之间彼此孤立，经验无法自动累积**。

```
当前架构：

用户输入 → agent 响应 → 响应返回用户
                           ↓
                      存入 DB（对话历史）
                           ↓
                       结束，无后续
```

每次对话启动时，agent 的 `/memories/AGENTS.md` 是静态的 seed 模板，内容完全依赖 agent **自觉**调用 `edit_file` 来更新。实际运行中，agent 很少主动写记忆。

### 1.2 差距分析（vs Hermes Agent）

| 能力 | 当前状态 | 目标 |
|------|----------|------|
| 对话后自动提取经验 | ❌ 无 | 每次对话结束自动反思，写入记忆 |
| 跨会话搜索历史 | ❌ 无工具 | agent 可搜索历史对话内容 |
| 技能评分驱动改进 | ❌ 数据已收集但未被消费 | 低分技能自动生成改进建议 |
| Agent 自觉写记忆 | ⚠️ 依赖 LLM 主动性 | 作为补充而非主路径 |

### 1.3 目标

在不改动 deepagents 核心库、不改动前端的前提下，为 agent 增加三个学习闭环能力：

1. **后执行反思** — 对话结束时自动提取经验写入员工记忆文件
2. **会话搜索** — agent 可调用工具检索历史对话
3. **技能评分 → 改进建议** — 低分评分自动触发技能优化分析

三人月皆可独立上线，互不阻塞。

### 1.4 学习闭环全景图

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Agent 学习闭环                                │
└─────────────────────────────────────────────────────────────────────┘

  ┌──────────┐
  │  用户输入 │
  └────┬─────┘
       │
       ▼
┌──────────────────────┐
│  Agent 对话 + 执行    │  ← 加载 /memories/AGENTS.md（已有记忆）
│  (deepagents 循环)    │  ← 加载 /skills/（已有技能）
│                      │  ← 可调用 session_search 搜索历史
└──────────┬───────────┘
           │
           ▼
┌───────────────────────────────────┐
│  _finalize_task_stream            │
│  (stream_state = "completed")     │
└────────────┬──────────────────────┘
             │
       ┌─────┴─────┐
       │           │
       ▼           ▼
┌──────────────┐  ┌──────────────────────────────────────┐
│  后执行反思   │  │  用户评分 (SkillRating)               │
│              │  │                                      │
│  限流检查     │  │  score < 3 + comment 存在             │
│  提取经验     │  │          │                           │
│  写入        │  │          ▼                           │
│  AGENTS.md   │  │  trigger_improvement_review          │
│              │  │    ├─ 读 SKILL.md                    │
│              │  │    ├─ 读对话上下文                    │
│              │  │    ├─ LLM 分析                       │
│              │  │    └─ 写 improvement-suggestion.md   │
└──────┬───────┘  └──────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────┐
│  下次对话启动                                  │
│                                              │
│  /memories/AGENTS.md（已更新）───→ 注入 prompt │
│  /skills/（外部管理）────────────→ 按需加载     │
│  session_search 工具 ──────────→ 可检索历史    │
└──────────────────────────────────────────────┘
       │
       └──────────────┐
                      ▼
              ┌──────────────┐
              │   循环往复    │  记忆持续积累，经验持续沉淀
              └──────────────┘


  ┌─── 数据流向 ──────────────────────────────────────────────┐
  │                                                          │
  │  conversation_messages (SQLite)                           │
  │    └─ content ──→ FTS5 ──→ session_search 工具            │
  │                                                          │
  │  /memories/AGENTS.md (文件)                                │
  │    └─ 每次对话启动自动加载                                 │
  │    └─ 反思引擎增量追加                                     │
  │    └─ agent 也可 edit_file 手动更新                        │
  │                                                          │
  │  {skill_path}/{eid}/skills/{name}/                        │
  │    └─ SKILL.md (外部导入，只读)                            │
  │    └─ improvement-suggestion.md (自动生成)                 │
  └──────────────────────────────────────────────────────────┘
```

---

## 2. 后执行反思引擎

### 2.1 概述

每次对话结束后，在 `_finalize_task_stream` 中追加一个异步回调，用辅助 LLM 分析本次对话内容，提取新的员工偏好、环境事实和经验教训，增量写入 `/memories/AGENTS.md`。

### 2.2 数据流

```
StreamRegistry._run_agent_background()
  → 最终调用 _finalize_task_stream(conversation_id, "completed")

_finalize_task_stream()
  ├─ 更新会话状态（已有）
  ├─ 更新 TaskExecutionLog（已有）
  ├─ 推送 on_task_finalized 事件（已有）
  ├─ 【新增】反射引擎
  │    ├─ 限流检查（同员工 60s 内不重复）
  │    ├─ 查询本次对话 messages
  │    ├─ 读取当前 /memories/AGENTS.md
  │    ├─ 调用辅助 LLM 提取新经验
  │    ├─ 增量写入 AGENTS.md（追加在「---」分隔线前）
  │    └─ 异常不影响主流程
  └─ db.close()
```

### 2.3 触发条件

| 条件 | 说明 |
|------|------|
| `stream_state == "completed"` | 仅成功完成的对话触发 |
| `employee_id` 存在 | 非匿名对话才需要保存记忆 |
| 限流通过 | 同一员工距上次反思 >= 60 秒 |
| 有实际对话内容 | messages 不为空 |

### 2.4 核心函数

**`reflection_engine.run_reflection(conversation_id, employee_id, db)`**

同步函数，在 `_finalize_task_stream` 的线程池中调用。

步骤：
1. `_acquire_reflect_lock(employee_id)` — 内存锁 + 60s 超时
2. `_get_conversation_messages(db, conversation_id)` — 最多 50 条，单条截断 2000 字符
3. `_resolve_memories_path(employee_id)` — `{skill_path}/{employee_id}/memories/AGENTS.md`
4. `_build_llm()` — 复用主模型（未来可切到廉价辅助模型）
5. 拼 prompt → LLM 提取 → 写入文件

### 2.5 Prompt 模板

```
你是一个经验提取助手。分析以下对话，从用户表述中提取：
1. 用户的偏好（沟通风格、格式偏好、术语偏好等）
2. 环境事实（路径、配置、工具版本等）
3. 经验教训（踩了什么坑、什么做法更好）
4. 约定（项目惯例、命名规范等）

已有的记忆：
{current_memory}

对话内容：
{messages}

输出格式：每行一条，以「§」开头。不要重复已有记忆。如果没有新发现，输出「无」。
```

### 2.6 限流策略

```python
_reflect_locks: dict[int, float] = {}  # employee_id → last_reflect_time

def _acquire_reflect_lock(employee_id: int) -> bool:
    now = time.time()
    last = _reflect_locks.get(employee_id, 0)
    if now - last < 60:
        return False
    _reflect_locks[employee_id] = now
    return True
```

### 2.7 涉及变更

| 文件 | 操作 | 行数 |
|------|------|------|
| `apps/server/src/service/reflection_engine.py` | **新增** | ~90 |
| `apps/server/src/service/stream_registry.py` | `_finalize_task_stream` 追加调用 | ~5 |

---

## 3. 会话搜索工具

### 3.1 概述

为 `conversation_messages.content` 建立 SQLite FTS5 全文索引，新增 `session_search` LangChain tool，agent 可在对话中搜索历史记录。

### 3.2 架构

```
agent 调用 session_search(query="部署步骤", limit=5)
  → FTS5 MATCH 查询
  → 关联 conversation_messages 表
  → 按员工隔离（employee_id）
  → 返回 JSON [{conversation_id, snippet, time}, ...]
```

### 3.3 FTS5 索引

**位置**: `apps/server/src/db/init_db.py` 新增 `_init_fts5()`

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS conversation_messages_fts
USING fts5(content, content='conversation_messages', content_rowid='id', tokenize='unicode61');

CREATE TRIGGER IF NOT EXISTS cm_fts_insert AFTER INSERT ON conversation_messages
BEGIN
    INSERT INTO conversation_messages_fts(rowid, content) VALUES (new.id, new.content);
END;

-- 首次重建
INSERT INTO conversation_messages_fts(conversation_messages_fts) VALUES('rebuild');
```

### 3.4 工具签名

```python
@tool
def session_search(query: str, limit: int = 5) -> str:
    """搜索历史对话记录。当你需要回忆之前讨论过的内容时使用。
    
    Args:
        query: 搜索关键词
        limit: 返回结果数（默认 5）
    """
```

返回值 JSON 格式：
```json
{
  "results": [
    {
      "conversation_id": 123,
      "snippet": "部署步骤是：先构建镜像，再推送到仓库...",
      "time": "2026-05-16 14:30:00"
    }
  ]
}
```

### 3.5 员工隔离

通过 subquery 过滤 `conversations` 表：
```sql
AND cm.conversation_id IN (
    SELECT id FROM conversations
    WHERE target_type = 'employee' AND target_id = :eid
)
```

curator 对话（`target_type = 'curator'`）不设搜索工具。

### 3.7 已知限制

**FTS5 仅索引 `conversation_messages.content`，不包含工具调用输出。**

| `content` 包含 | `content` 不包含 |
|---|---|
| 用户问题 | 工具调用结果（SQL 查询、脚本输出、文件内容等） |
| agent 最终文字回复 | 工具调用参数 |
| agent 的文字总结 | `message_parts` 中的结构化数据 |

**影响场景**：
- ✅ 可搜索："上次部署是怎么做的"（agent 会总结步骤到 content）
- ❌ 难搜索："上次 SQL 查询结果是什么"（原始数据在 `message_parts`）
- ❌ 难搜索："上次执行脚本报了什么错"（错误在工具输出中）

**后续评估**：上线后观察搜索命中率，若工具输出相关搜索频繁失败，考虑方案 B（content + message_parts 联合索引）或方案 C（在 `_flush_terminal` 时将关键工具输出拼接到 content）。

### 3.8 涉及变更

| 文件 | 操作 | 行数 |
|------|------|------|
| `apps/server/src/db/init_db.py` | 新增 `_init_fts5()` 调用 | ~20 |
| `apps/server/src/service/session_search.py` | **新增** | ~80 |
| `apps/server/src/service/agent.py` | `get_agent()` 中注入 tool | ~15 |

---

## 4. 技能评分 → 改进建议

### 4.1 概述

`SkillRating` 已收集用户评分和评价（`score`, `comment`），但从未被消费。当评分低于 3 分且带评价时，自动触发 LLM review，在技能目录下生成 `improvement-suggestion.md`。

### 4.2 数据流

```
用户评分（API: POST /skill-ratings）
  → SkillRatingService.create_from_task_log()
    ├─ 创建 SkillRating 记录（已有）
    ├─ 同步远程（已有）
    └─ 【新增】if score < 3 and comment:
         → trigger_improvement_review()
           ├─ 读取技能 SKILL.md
           ├─ 读取关联对话上下文
           ├─ 调用 LLM 分析
           └─ 写入 <skill_dir>/improvement-suggestion.md
```

### 4.3 触发条件

| 条件 | 说明 |
|------|------|
| `score < 3` | 仅对差评触发 |
| `comment` 非空 | 没评论无法分析改进方向 |
| 技能文件存在 | SKILL.md 在磁盘上 |

### 4.4 输出文件

**位置**: `{skill_path}/{employee_id}/skills/{skill_name}/improvement-suggestion.md`

```markdown
# 技能改进建议

## 评分信息
- 评分: 2/5
- 用户评价: 生成的数据格式不符合预期

## 分析结果
reason: 技能描述不够清晰，用户期望 JSON 格式输出但 SKILL.md 未指定输出格式
improvements:
  - 在 Procedure 末尾增加"输出格式"步骤，明确返回 JSON schema
  - 增加示例代码
```

### 4.5 涉及变更

| 文件 | 操作 | 行数 |
|------|------|------|
| `apps/server/src/service/skill_improvement_service.py` | **新增** | ~90 |
| `apps/server/src/service/skill_rating_service.py` | `create_from_task_log` 末尾追加调用 | ~8 |

---

## 5. 不涉及变更

以下模块均不动：

- **前端**（`apps/web/`、`packages/ui/`）— 全部在 backend 侧
- **deepagents 核心库** — 只扩展已有中间件和 tool 模式
- **数据库 schema** — FTS5 是独立 virtual table，不修改现有表
- **API 路由** — 不新增 HTTP 接口
- **现有 agent 行为** — 反思是后置回调，session_search 是可选工具，不影响对话主流程

---

## 6. 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| 反思 LLM 调用增加 token 消耗 | 每次对话固定消耗 ~2-4k tokens | 限流 60s/人 + 对话太早结束（< 3 条消息）跳过；未来可切到廉价模型 |
| FTS5 影响写入性能 | 触发器增加 INSERT 开销 | FTS5 触发器是同步但极轻量，生产环境量级（~ms/条）无感知 |
| 技能改进建议覆盖用户手动维护 | 用户本地修改被覆盖 | 只写 `improvement-suggestion.md`，不动 `SKILL.md` 本身 |
| 反思引擎写 AGENTS.md 和 agent 手动写冲突 | 两者同时修改 | 反思引擎只追加新条目，不重写整个文件；agent 通过 `edit_file` 修改时可能覆盖，但 agent 很少主动写 |

---

## 7. 验收标准

- [ ] 完成一次对话后，`{skill_path}/{employee_id}/memories/AGENTS.md` 中新增了反思提取的条目
- [ ] agent 在对话中调用 `session_search` 工具，返回相关历史结果
- [ ] 给低分技能评分后，`{skill_path}/{employee_id}/skills/{skill_name}/improvement-suggestion.md` 生成
- [ ] 所有异常不影响主对话流程（反射/搜索/改进建议失败不阻塞用户）
- [ ] 对话 < 3 条消息不触发反思
- [ ] 同一员工 60s 内多次对话只触发一次反思
