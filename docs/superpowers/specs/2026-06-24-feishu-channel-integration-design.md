# 飞书 Channel 接入设计

> 状态：设计评审中
> 日期：2026-06-24
> 分支：feat/orchestrator-centric

## 1. 目标

让飞书成为总管（orchestrator）的一个**入站指令渠道 + 回执出口**：

- 白名单内的飞书用户私聊机器人下达指令 → 路由到总管执行；
- 立即回 ACK；该指令触发的那一轮跑到终态后，回发结构化报告（含交付物）。

本设计把"飞书"做成**第一个具体 Channel 实现**，接缝全部 channel-无关，未来接钉钉 / 企微 / Slack = 新增一个 `Channel` 子类并注册，**零改 schema、零碰核心编排、零改分发器**。

### 明确不在本设计范围（后续单独讨论）

- 总管 / 员工**主动**向飞书发任意富消息（发到别的群、发文档、发卡片等）→ 走 **lark-cli skill**（agent 在运行时调技能），不在 channel 里硬编码。
- 定时轮（scheduled run）结果自动推飞书 → 需要给定时轮单独打 source，列为后续。
- 多渠道配置 DSL / 插件热加载等过度设计。

## 2. 关键决策（已与用户敲定）

| # | 决策点 | 结论 |
|---|---|---|
| 1 | 连通方式 | **飞书长连接（WebSocket，wss 直连飞书开放平台）**。客户端连出，免公网 URL，适配桌面端 NAT 部署。 |
| 2 | 渠道→工作空间映射 | 机器人私聊 = **默认 / 当前激活工作空间**。 |
| 3 | 授权 | **open_id 白名单**；非白名单消息拒答（可配静默）。 |
| 4 | 回执时机 | **立即 ACK + 最终报告**两拨。 |
| 5 | ACK / 报告回发归属 | **channel 自己回发**（同一套机器人凭证，回到来源 chat）。 |
| 6 | source 粒度 | **按轮 / 按消息**（不是按会话）。一条飞书入站 = 一行 inbox，"这行存在"即该轮 `source=feishu`。 |
| 7 | 专属会话 | 每渠道一个**唯一**总管会话，仅做"容器 + UI 特殊样式"，**不参与回执路由**。用户可直接在该会话里敲字，那种消息无 inbox 行 → 不回执飞书。 |
| 8 | 出网 | 直连飞书；**离线版天然不启用**（启动护栏空操作）。 |
| 9 | 通用化 | 后续会接其他 channel，故现在就抽 `Channel` 接口 + `ChannelManager` + 通用 `ChannelInbox` 表。仅实现飞书。 |

## 3. 架构总览

```
飞书用户(白名单 open_id) 私聊机器人
        │  lark-oapi WebSocket 长连接(wss 直连，免公网)
        ▼
FeishuChannel.on_message(event)
        │ ① external_event_id 去重(ChannelInbox)
        │ ② 白名单校验 open_id
        │ ③ ensure 专属飞书总管会话(默认工作空间, 幂等, 唯一)
        │ ④ inject_curator_instruction(会话, 文本, source_meta)  ← 复用 headless 注入
        │ ⑤ 写 ChannelInbox 行(status=acked), 立即回飞书 "✅ 收到"
        ▼
总管照常执行(纯对话回复 / 或拆成 PlanRun 多子任务)  ——异步，核心编排零感知 channel
        ▼
该轮到终态(stream 结束 且 PlanRun 终态)
        │  ChannelManager 订阅 WorkspaceEventBus 终态事件
        │ ⑥ 查 ChannelInbox 命中 pending 行 → 取其 channel → 路由到 FeishuChannel
        │ ⑦ 拉 orchestrator_execution_summary(结果 + 交付物)
        │ ⑧ FeishuChannel.send_report(chat_id, report) → status=reported
        ▼
飞书用户收到回执
核心编排代码：依旧零感知任何 channel
```

## 4. 组件与隔离边界

### 4.1 `Channel` 接口（抽象，每渠道实现一份）

```
name                          # "feishu" / 未来 "dingtalk" / "slack"
start() / stop()              # 入站监听生命周期
is_authorized(ext_user_id)    # 白名单校验
parse_inbound(event)          # 渠道事件 → 统一 InboundMessage(ext_user_id, ext_chat_id, text, event_id)
send_ack(chat_id, text)       # 出站：收到确认
send_report(chat_id, report)  # 出站：最终报告
```

### 4.2 `ChannelManager`（单例）

- **生命周期**：`server.py` lifespan 启动（在调度器之后）→ 遍历"已启用且配置完整"的渠道逐个 `start()`；shutdown 逐个 `stop()`。
- **分发器**：订阅 `WorkspaceEventBus` 终态事件 → 查 `ChannelInbox` 的 pending 行 → 按行的 `channel` 字段找对应 `Channel` 实例 → `channel.send_report(...)`。**按 channel 路由，与具体渠道解耦。**

### 4.3 `FeishuChannel`（唯一具体实现）

- 后台线程跑 lark-oapi WebSocket 长连接 client + 消息回调。
- **启动护栏**：`feishu_platform` 能力关 / 未配 `feishu_app_id`·`feishu_app_secret` / 白名单为空 → **不启动**（空操作），不影响主程序；离线版天然落入此分支。
- 白名单：`get_settings()` 新增 `feishu_channel_enabled` + `feishu_whitelist_open_ids`。
- 出站 `FeishuIMService.send_text / send_card(chat_id, ...)`：直连 lark-oapi（不绕 RemoteGateway）。

### 4.4 数据模型

**新增 `ChannelInbox`（通用，channel 判别）—— 机制的真相源**

| 字段 | 用途 |
|---|---|
| `channel` | 判别器："feishu" / 未来其他 |
| `external_event_id` (unique) | 渠道事件去重（飞书会重投） |
| `external_user_id` | 渠道侧发送者（open_id 等） |
| `external_chat_id` | 回执发回的地址 |
| `workspace_id` / `conversation_id` | 落到哪个工作空间的专属会话 |
| `user_message_id` / `assistant_message_id` | 关联触发的那一轮 |
| `plan_run_id` (nullable) | 若该轮拆了编排轮，回填 |
| `status` | received → acked → running → reported / failed |
| `reported_at` | 回执时间 |

**`Conversation` 新增 `channel` 字段**：判别器 + UI 特殊样式；`null` = 普通 Web 会话。每渠道一个唯一会话，`ensure_channel_curator_conversation(db, user_id, workspace_id, channel)` 幂等返回。**不参与回执路由**（路由由 ChannelInbox 决定）。

### 4.5 重构（targeted，in-scope）

把 `task_scheduler_service._start_curator_task` 里"注入 user 消息 + 起 orchestrator 流"那段抽成共享 `inject_curator_instruction(db, conversation, text, *, source_meta)`，调度器 / 所有渠道共用，避免两份 headless 注入逻辑漂移。

### 依赖关系

```
ChannelManager ──注册──> [FeishuChannel, (future) DingtalkChannel...]
     │ 订阅 WorkspaceEventBus 终态 → 查 ChannelInbox.channel → 路由到对应 Channel.send_report()
FeishuChannel
  ├─依赖→ lark-oapi ws client          (入站长连接)
  ├─依赖→ inject_curator_instruction   (复用注入，不自己写编排)
  ├─依赖→ ChannelInbox                 (去重 / 关联 / 状态)
  ├─依赖→ orchestrator_execution_summary (拉报告内容)
  └─依赖→ FeishuIMService              (ACK / 回执出站)
核心编排代码：零改动、不知道任何 channel 存在
```

## 5. 终态判定（一条飞书指令何时算"跑完"）

| 场景 | 终态信号 | 回执内容来源 |
|---|---|---|
| 纯对话回复（总管直接答，没拆活） | orchestrator 流结束、未产生 PlanRun | 总管最终回答文本 |
| 拆成编排轮（产生 PlanRun + 子任务） | 该 PlanRun 到终态（completed / partially_failed / cancelled） | `orchestrator_execution_summary` 聚合 |

**机制（事件驱动 + 幂等兜底）**：

1. 注入时拿 `assistant_message_id` 写进 inbox（status=acked）。
2. 流结束事件 → 查这轮有没有产生 PlanRun：
   - 没有 → 纯回复，**立刻回执**（status=reported）。
   - 有 → 回填 `plan_run_id`，status=running，**先不发**，等 PlanRun 终态。
3. PlanRun 终态事件 → 按 `plan_run_id` 命中 inbox → 回执 → status=reported。
4. **幂等兜底**：收到任何与该会话相关的终态事件，都对 pending 行重判一次"是否真的全完了"，由 `status` 去重防重发——容忍漏事件 / 重复事件。
5. 若 `orchestration_lifecycle` 终态处尚未 push 总线事件，**补一个 channel-无关的领域事件**（SSE / 通知中心同样受益），而非塞飞书钩子。

## 6. 回执内容格式

- **ACK**：`✅ 收到，已开始执行：<指令摘要>`；并发槽满时 → `⏳ 已排队`（复用现有 `slot_busy` 队列语义）。
- **报告**：起步用飞书 markdown 文本（卡片留后续）：
  ```
  【执行完成 / 部分失败】
  指令：<原文截断>
  子任务：✅ A  ✅ B  ❌ C(失败原因)
  交付物：report.xlsx、分析.md
  ```
  纯对话场景直接发总管回答文本。超长 → 截断 + "详见客户端"。

## 7. 错误处理

| 情况 | 处理 |
|---|---|
| 非文字消息（图 / 文件 / 语音） | 回 `暂只支持文字指令`（可配静默） |
| 未授权 open_id | 默认回 `未授权`（可配静默）+ 记日志 |
| 重复 external_event_id | inbox 去重，空操作 |
| 注入 / 执行失败 | status=failed，回 `❌ 执行失败：<原因>` |
| 长连接断开 | lark-oapi 自动重连，ChannelManager 监管 + 日志 |
| 后端重启时有 running 中的轮 | 启动时对账：会话 / 轮已死 → 回 `执行被中断` 并收尾，不留悬挂 |
| 回发失败（飞书侧故障） | 重试数次，仍失败保留状态待重试 |
| 并发：多条飞书指令同时来 | 复用现有并发槽队列；ACK 区分"已开始 / 已排队" |

## 8. 复用现有代码

| 用途 | 现有资产 |
|---|---|
| headless 注入指令 + 起 orchestrator 流 | `task_scheduler_service._start_curator_task`（抽成共享函数） |
| 终态触发 | `WorkspaceEventBus`（channel 是又一个订阅者，和 SSE 通知中心平级） |
| 报告内容聚合 + 交付物清单 | `orchestrator_execution_summary.py` / `collect_plan_deliverables` |
| 飞书凭证 | `get_settings()` 的 `feishu_app_id` / `feishu_app_secret`（`feishu_token_service` 已在用） |
| 能力开关 | `require_capability("feishu_platform")` |

## 9. 未决 / 后续

- 飞书卡片（interactive card）形态的富报告（起步先文本）。
- 定时轮结果自动推飞书（需给定时轮打 source）。
- 总管 / 员工主动发飞书富消息 → lark-cli skill 方案。
- 实现前做一个**长连接连通性 spike**：用配置好的 app 凭证起一个 lark-oapi ws client，确认能直连飞书 wss 网关并收到一条测试消息回调。
