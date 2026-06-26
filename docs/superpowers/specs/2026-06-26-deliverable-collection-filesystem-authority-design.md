# 产物收集重构:以资源管理器为权威 + per-turn 执行日志归属

**日期:** 2026-06-26
**状态:** 设计已评审,待实现

## 背景与问题

当前产物(deliverable/artifact)收集是**双源**的,两个来源各扫各的、会对不上:

1. **消息气泡里的产物卡片**(`FileChangeCards` / `PlanDeliverablesCard`):靠解析对话里的
   `tool-write_file` / `tool-edit_file` 工具调用(`collect_plan_deliverables` 扫
   `message_parts`),再用 `_looks_like_product` 过滤路径。
2. **资源管理器面板**:直接扫文件系统 `product_root`(`resource_service.list_resources`)。

这套机制有三个硬伤:

- **漏**:`shell_execute`(bash)写的文件落在同一个 `product_root/artifacts`,但不走
  `write_file` 工具,所以解析 `message_parts` 时被完全漏掉。
- **脏**:工具调用报了但磁盘上已被删的文件、空文件,仍会出现在卡片里。
- **不一致**:卡片(工具调用驱动)和资源管理器(文件系统驱动)结构性对不上。

## 关键约束(已取证)

来自对 `apps/server` 执行层的调研:

- `write_file` / `edit_file` 同步直写 `product_root/artifacts`,无临时目录、无批量
  commit(`basic_file_backend.py`)。
- `shell_execute` 的 subprocess `cwd = artifacts_dir`,bash 写的文件也落在同一个
  `artifacts` 目录(`skill_shell_backend.py`)。
- **并发是硬约束**:多个会话(员工 + 总管 + 定时)共写同一个 `root/artifacts`,无锁,
  last-write-wins(SP2 既定取舍,`workspace_paths.py`)。
- "一轮"对员工会话的天然边界 = **一条 assistant 消息**(有 `created_at`、`stream_state`、
  `extra_meta`,编排场景可带 `run_id`);没有独立 `round_id` 但不缺标识。

**由此推出的核心结论:** 纯文件系统在并发共享目录下**做不到按轮归属** —— 文件系统只知道
"现在有哪些文件",不知道"是哪一轮、哪个会话写的"。mtime 时间窗、轮首快照-轮尾 diff 这类纯
文件系统方案会把别的会话写的文件算到本轮头上。归属信息必须由执行层提供。

## 设计目标

1. 消息卡片只显示**本轮新增 + 本轮改动**的产物(`create` 与 `modify` 都算)。
2. 文件的存在性 / 内容以资源管理器(文件系统)为唯一权威 —— 删了就不显示、空文件不算。
3. 抓住 bash 写的文件。
4. 并发安全:归属不靠时间窗猜。
5. 消灭卡片与资源管理器的双源不一致。

## 核心思想:职责拆分

| 职责 | 唯一权威 |
|---|---|
| 文件现在是否存在 / 内容 / 大小 | 资源管理器(文件系统扫描,`resource_service`) |
| 某文件是哪一轮、哪个会话产出的 | 执行期写入日志(per-turn journal) |

**渲染恒等式:** `消息卡片 = 本轮 journal 路径 ∩ 文件系统当前条目`。

资源管理器面板维持全景视图不变。卡片永远是面板的"本轮"子集,双源不一致被结构性消灭。

## 组件设计

### 1. 数据模型:journal 存哪

存进**该轮 assistant 消息的 `extra_meta`**(已是 JSON、已落库),新增字段:

```json
"file_outputs": [
  { "path": "artifacts/报告.md", "action": "create", "bucket": "artifacts" },
  { "path": "artifacts/data.csv", "action": "modify", "bucket": "artifacts" }
]
```

- `path`:相对 `product_root` 的路径(与 `resource_service` 条目同一坐标系,便于做交集)。
- `action`:`create` | `modify`,由"写前文件是否已存在"判定。
- `bucket`:`artifacts` | `skills_draft`(只收这两个桶,与现有 `isUserVisibleFileChange` 一致)。

### 2. 采集机制(三个写入口都覆盖)

执行一轮时,用一个 **contextvar 持有"本轮 journal 累加器"**,在 stream 开始时按当前
assistant 消息建立,绑定 `conversation_id`(+ 编排场景的 `run_id`)。

- **write_file / edit_file**(`basic_file_backend`):写盘当下 append
  `{path, action}`。`action` 由写前 `os.path.exists(resolved_path)` 判定
  (存在 → `modify`,不存在 → `create`)。
- **shell_execute**(`skill_shell_backend`):对每一次 subprocess 执行,**前后各递归扫一次
  artifacts(+ skills-draft)桶**,取 delta(新增路径、或 mtime/size 变化的路径)归入累加器,
  `action` 同样按"执行前是否存在"判定。这是抓住 bash 写文件的关键。
- 流结束(`stream_state` → `completed`)时,累加器**按 path 去重**(同一文件多次写只留最终
  action:出现过 create 即 create,否则 modify)后落进 `message.extra_meta.file_outputs`。

**并发安全性:** 每个写都在自己会话/消息的 contextvar 上下文里执行,归属天然正确,不靠全局
时间窗猜。bash 的窄 diff 只覆盖单条命令的执行窗;在"同一秒两条 shell 并发写共享目录"的极端
情形下仍有微小串台窗,此时**记一条取证日志**兜底,不阻塞写入。

### 3. 收集 API 改造

- `collect_plan_deliverables`(`orchestration_lifecycle.py`):**彻底替换**旧的
  `message_parts` 工具调用解析逻辑,改为遍历本 `run` 各 `TaskExecutionLog` 对应 assistant
  消息的 `extra_meta.file_outputs`。`run_id` 隔离逻辑(`resolve_run_id_for_conversation`)
  保持不变。
- 收集后**与当前文件系统求交集**(复用 `resource_service` 的扫描结果),过滤掉:
  ① 创建后又被删的;② 空文件;③ 不在 artifacts / skills_draft 桶的。
- 旧的 `_looks_like_product` 路径启发式判定不再需要(桶判定由 journal 的 `bucket` 字段 +
  `resource_service` 的桶归类承担)。

### 4. 渲染路径(统一为一条)

- **员工会话**:`FileChangeCards` 改为读该条 assistant 消息的 `file_outputs`(而非从
  `message_parts` 的 tool parts 重建),再与 `apiResourceList` 求交集。
- **编排计划**:`PlanDeliverablesCard` 数据来自改造后的 `collect_plan_deliverables`,
  per-run 隔离不变。
- `file-change-utils.ts` 的 交付物 / 中间产物 分类(按扩展名)保持不变,作用在 journal
  派生的列表上。
- `artifact-store` 的流式 pending 逻辑**保留**:流式中先用工具事件即时显示正在写的文件,
  落库后由 `message.extra_meta.file_outputs` 取代(现有 `useConversationPendingResources`
  的 pending 清理时机不变)。

### 5. 边界与取舍

- **不做向后兼容、不做数据迁移**(开发阶段)。历史消息没有 `file_outputs` 字段 → 卡片就
  不显示历史产物(资源管理器面板仍能看到磁盘上的全部文件)。旧的 `message_parts` 解析器
  **直接删除**,不保留为 fallback。
- 同轮内"创建又删除"→ 因与文件系统求交集,自动不显示。
- 外部 flat 工作空间:journal 的桶判定复用 `resource_service` 现有 flat 分支的桶归类规则,
  保持一致。
- 内部临时文件(`_agent_exec_` 前缀等)沿用 `resource_service` 的 `_is_internal_scratch`
  过滤,不进 journal。

## 测试策略

- **单测(后端)**
  - `write_file` 写已存在文件 → journal `action=modify`;写新文件 → `create`。
  - `edit_file` → `modify`。
  - bash 写新文件 → 被 subprocess 前后窄 diff 抓到并进 journal。
  - 收集结果与文件系统求交集:创建后被删的文件、空文件被过滤掉。
  - 并发两会话各写各的文件 → 各自 `file_outputs` 归属正确,不串台。
  - 同 path 多次写 → 去重后只留一条,action 合并正确。
- **回归**:复用 `test_deliverable_isolation.py` 验证 `run_id` 隔离在新路径下不回归。
- **集成**:一轮 agent 执行(混合 write_file + bash + edit_file)后,`collect_plan_deliverables`
  与 `FileChangeCards` 显示一致,且都是面板的子集。

## 受影响文件(预估)

后端:
- `apps/server/src/service/agent/basic_file_backend.py` —— write_file/edit_file 写 journal
- `apps/server/src/service/skill_shell_backend.py` —— shell_execute 前后窄 diff
- `apps/server/src/service/stream_registry.py` —— 流结束时落 journal 到 extra_meta;contextvar 生命周期
- `apps/server/src/service/orchestration_lifecycle.py` —— `collect_plan_deliverables` 改读 file_outputs + ∩ 文件系统;删旧解析
- (新增)journal 累加器 + contextvar 工具模块

前端:
- `apps/web/src/components/chat/message-blocks/file-change-cards.tsx` —— 读 file_outputs
- `apps/web/src/lib/chat/file-change-utils.ts` —— 输入源切换(分类逻辑不变)
- `apps/web/src/components/chat/message-blocks/plan-deliverables-card.tsx` —— 数据源不变(后端已改)
