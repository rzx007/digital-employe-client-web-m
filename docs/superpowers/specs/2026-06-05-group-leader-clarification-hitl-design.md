# 群组长澄清(HITL)设计

> **日期**:2026-06-05
> **状态**:设计稿(待实现)
> **作者**:协作设计(brainstorming 产出)
> **关联**:[群聊功能设计](../../group-chat-design.md)、[多智能体编排](../../multi-agent-orchestration-plan.md)、`apps/server/src/service/agent/AGENTS.md`(HITL 约定)、`apps/server/docs/hitl-architecture.md`

## 一、目标

让**群组长**在用户需求**模糊**时,通过**真正的 HITL 中断**先向用户澄清,待用户回答清楚后再把任务下发给成员。

**典型场景**:用户在群里发"帮我写个文档" → 组长判断信息不足(主题/受众/篇幅/格式不明)→ 在群时间线弹出**结构化澄清卡片** → 用户作答 → 组长信息足够 → 拆解派活给成员。

### 1.1 已拍板的语义边界

| 决策 | 结论 |
| --- | --- |
| 澄清后是否还要二次确认方案 | **否**。澄清够了组长自己判断就直接派活,不再要用户确认计划。 |
| 何时澄清 | **仅当需求模糊时**。需求已清晰则直接拆解派活,不打扰。 |
| 实现机制 | **真正的 HITL**:复用组长 orchestrator 已有的 `submit_clarifying_questions` 中断 + `Command(resume)` 恢复,不重造。 |
| 作答方式 | **复用 1:1 的结构化澄清卡片**,渲染到群时间线,提交走现有 `/approve` 端点。 |
| 适用角色 | **仅组长**。成员(编排派活)仍 `enable_hitl=False`、禁止澄清,保持自主执行。 |

## 二、现状(为什么只需"桥接")

HITL 澄清这套机器在 1:1 / 总管已完整存在,组长复用的就是同一套:

- **组长 agent 已挂澄清能力**:`dispatch_to_leader` 用 `get_orchestrator_agent`,其 `interrupt_on = build_orchestrator_interrupt_on(session_flags)` 已包含 `submit_clarifying_questions`,工具也已注册(`apps/server/src/service/agent/orchestrator/agent.py:214,241,253`;`apps/server/src/service/agent/destructive_hitl.py:26`)。
- **中断检测与落库**:`StreamRegistry` 运行循环检测 `state.tasks[].interrupts` → `_extract_interrupt_payload`(`stream_registry.py:449,1626-1650`)→ 终态 `interrupted` → 通过 `extract_message_parts_for_interrupt`(`hitl_pending_parts.py`)把澄清问题落库为该 assistant 消息的 `message_parts`,`stream_state="interrupted"`。
- **作答恢复**:唯一提交端点 `POST /chat/conversations/{id}/approve`(`chat_api.py:365`)→ `ChatService.approve_trigger`(`chat_service.py:1086`)→ 封存中断段 + 新建 assistant 行 → `registry.approve_and_resume`(`stream_registry.py:1234`)用 `Command(resume={"decisions": decisions})` 继续 agent。澄清答案与破坏性 approve **共用**此端点(payload 为 decisions)。
- **群逐字流式**:`_GROUP_STREAM_RELAY` + `register_group_stream_relay` / `relay_group_stream_delta`(`group_room_service.py`),组长/成员产出 token 时逐字推到群时间线(`room_message_stream`),`_finalize_task_stream` 终态时 `unregister_group_stream_relay` + 投影完整消息(`stream_registry.py:1789+`)。

**缺口**:整套 HITL 默认面向"会话本人"(组长会话 `target_type=group_leader`),而群用户是在**群时间线**(`target_type=group`)交互。组长一旦 `submit_clarifying_questions` 中断,问题只落在组长会话,群里既看不到也无法作答。**本设计只补两座桥**:中断**桥出**到群时间线,作答**桥回**去 resume 组长流。

此外,组长当前 brief 被写成"全程自主完成、不要等确认"(`group_room_service.py` `dispatch_to_leader` 的 `leader_brief`),主动压制了澄清,需要解除。

## 三、设计

### 3.1 改动点 ①:组长提示词 + 澄清开关

- **文件**:`apps/server/src/service/group_room_service.py`(`dispatch_to_leader` 的 `leader_brief`)。
- **改动**:在现有"拆解 → 派活"流程前加判断分支:
  - 需求模糊(目标 / 范围 / 交付物 / 受众 / 格式 等关键信息不足)→ **本轮必须调用 `submit_clarifying_questions`**(`context` 取 `long_document` 或 `general`),禁止只在聊天里列问题(否则不触发澄清门);调用后停下,不要 `create_orchestration_plan`、不要派活。
  - 需求已清晰 → 按原流程(先说一句安排 → `create_orchestration_plan` → `confirm_orchestration_plan`)派活。
- **开关核对**:确认 `group_leader` 会话对应的 `session_flags` 不会把 `submit_clarifying_questions` 从 `interrupt_on` 中移除;解除 brief 里"全程自主、不要等确认"对澄清的压制(改为"无真人替你点确认,但需求模糊时须先澄清")。

### 3.2 改动点 ②:桥出(中断 → 群时间线卡片)

- **文件**:`apps/server/src/service/group_room_service.py`(`project_member_conversation_if_in_room` 分支 A,组长会话)。
- **现状**:分支 A 仅处理 `completed`(投影组长汇总)。
- **改动**:增加 `stream_state == "interrupted"` 分支:
  1. 读组长会话(`leader_conversation_id == conversation_id`)最后一条 `stream_state="interrupted"` 的 assistant 消息的 `message_parts`(即澄清问题结构)。
  2. 用 `post_to_timeline` 投影成群时间线一条消息,**携带该 parts**(使前端用同一套卡片组件渲染),并写 `extra_meta = {"clarify_target_conversation_id": <leader_conv_id>, "clarify_message_id": <interrupted_assistant_msg_id>}`,作者 = 组长(`sender_id=None, sender_label="组长"`)。
  3. 因为消息已落库,**刷新 / 重进会话不丢卡片**。
- **不触发误派**:`interrupted` 终态**不会**进入 `auto_confirm_leader_plan_if_pending`(它仅在 `stream_state == "completed"` 调用,见 `stream_registry.py:1789+`),且此时无 pending 计划。

### 3.3 改动点 ③:桥回(卡片作答 → resume 组长)

- **前端**:群时间线渲染 HITL 澄清卡片时,**提交目标会话 id 取 `extra_meta.clarify_target_conversation_id`(组长会话),而非当前群会话 id**;提交仍打 `POST /chat/conversations/{clarify_target_conversation_id}/approve`(复用现有 `hitl/clarifying-questions` 提交逻辑,仅替换目标 conversation_id 来源)。
- **后端**:`ChatService.approve_trigger` 在 resume 前,若 `conversation.target_type == "group_leader"` 且该会话属于某 `GroupRoom` → **重新注册群流中继** `register_group_stream_relay(leader_conv_id, ...)`,使组长 resume 后的输出继续逐字进群时间线。
- **resume 后**:组长信息足够 → `create_orchestration_plan` + `confirm_orchestration_plan` → `completed` → `auto_confirm_leader_plan_if_pending` 派活成员;信息仍不足 → 再次 `submit_clarifying_questions` → 回到 ②(**支持多轮澄清**)。

### 3.4 改动点 ④:守卫(interrupted 轮不误回流总管)

- **文件**:`apps/server/src/service/group_room_service.py`(`project_member_conversation_if_in_room` 分支 A)。
- **改动**:`_flow_summary_back_to_curator` 仅在**确实产出最终汇总/计划**(`completed` 且属于汇总轮)时触发;`interrupted` 轮**不得**回流(避免把澄清问题当成"群里的最终结果"转告总管会话)。

### 3.5 改动点 ⑤:awaiting-clarification 兜底

- **文件**:`apps/server/src/service/group_room_service.py`(`handle_group_message`)。
- **判定**:组长会话最后一条 assistant `stream_state == "interrupted"` ⇒ 处于"待澄清"态。
- **改动**:用户在群里发**普通消息(非 @)** 时:
  - 若组长处于待澄清态 → 把该消息当澄清作答,走与 ③ 同一条 resume 路径(`approve_trigger` + 重注册 relay),避免中断悬挂。
  - 否则 → 原逻辑 `dispatch_to_leader` 新开一轮。
- **@ 成员**:仍独立走 `dispatch_to_member`,不受组长中断态影响(用户可在澄清期间临时点名某成员)。

## 四、数据流

```
用户(群): "帮我写个文档"
  → handle_group_message → 组长非待澄清态 → dispatch_to_leader(注册 relay)
  → 组长流: 判断模糊 → submit_clarifying_questions → 中断
  → _finalize_task_stream(leader_conv, "interrupted")
      → unregister relay
      → project_member_conversation_if_in_room 分支A/interrupted
          → 读 interrupted 消息 parts → post_to_timeline(群, parts, extra_meta.clarify_target=leader_conv)
      → 不触发 auto_confirm、不回流总管
  → 群时间线出现【结构化澄清卡片】

用户(群): 在卡片上作答 → POST /approve 到 clarify_target_conversation_id(组长会话)
  → approve_trigger: 封存中断段 + 新建 assistant 行
      → (group_leader 且属房间) 重新 register_group_stream_relay(leader_conv)
      → approve_and_resume(Command(resume={"decisions": ...}))
  → 组长流恢复(逐字进群): 信息足够 → create+confirm → completed
      → auto_confirm_leader_plan_if_pending → 派活成员(成员 subagent 执行,结论投影回群)
   或 信息仍不足 → 再 submit_clarifying_questions → 回到上一段(多轮)
```

## 五、组件与接口

| 单元 | 职责 | 输入 | 依赖 |
| --- | --- | --- | --- |
| `dispatch_to_leader`(改 brief) | 引导组长"模糊则澄清,清晰则派活" | 用户群消息 | `get_orchestrator_agent` / `submit_clarifying_questions` |
| `project_member_conversation_if_in_room` 分支 A(扩展 interrupted) | 把组长中断的澄清问题投影成群卡片消息 | `leader_conv_id`, `interrupted` | `post_to_timeline`、interrupted 消息 parts |
| `approve_trigger`(扩展 group_leader 分支) | 作答恢复前重注册群 relay | `clarify_target_conversation_id`, decisions | `register_group_stream_relay`、`approve_and_resume` |
| `handle_group_message`(扩展待澄清判定) | 区分"新一轮 vs 澄清作答兜底" | 群消息、组长会话状态 | 组长会话 `stream_state` |
| 前端澄清卡片(群上下文) | 渲染澄清问题 + 提交到组长会话 | 群消息 parts + `extra_meta.clarify_target_conversation_id` | 现有 `hitl/clarifying-questions` |

**接口契约(关键)**:群时间线澄清消息的 `extra_meta` 必含 `clarify_target_conversation_id`(组长会话 id)与 `clarify_message_id`;前端据此把 `/approve` 打到组长会话而非群会话。

## 六、边界与异常

| 场景 | 处理 |
| --- | --- |
| **多轮澄清** | resume 后组长再次 `submit_clarifying_questions` → 再次桥出,卡片再现。无轮次硬上限(由组长自行收敛;提示词建议尽量一轮问清)。 |
| **待澄清期间 @ 成员** | 独立走 `dispatch_to_member`;组长中断态保留,不受影响。 |
| **待澄清期间发普通消息** | 兜底当作答 resume(改动点 ⑤),不悬挂中断。 |
| **取消** | 用户取消组长流 → 取消会话流,丢弃中断;群卡片置为失效态(沿用现有 cancel/interrupted 展示)。 |
| **刷新 / 重进会话** | 澄清卡片已落库(parts + extra_meta),正常重渲染;`/approve` 目标仍指向组长会话。 |
| **curator 发起的群** | `interrupted` 轮不回流总管(改动点 ④);仅最终汇总回流。 |
| **组长误把模糊需求直接建计划** | 与现状同风险(提示词缓解);最坏=提前派活,不引入新故障。 |

## 七、测试

**后端**
- 组长流 `interrupted` → `project_member_conversation_if_in_room` 在群时间线落库一条携带 clarify parts + `extra_meta.clarify_target_conversation_id` 的消息。
- 对 `target_type="group_leader"` 且属房间的会话调用 `approve_trigger` → 先 `register_group_stream_relay` 再 `approve_and_resume`。
- `interrupted` 轮**不**触发 `auto_confirm_leader_plan_if_pending`、**不**触发 `_flow_summary_back_to_curator`。
- `handle_group_message`:组长待澄清态下,普通消息走 resume 路径;非待澄清态走 `dispatch_to_leader`。

**前端**
- 群时间线能从消息 parts 渲染澄清卡片。
- 卡片提交目标 conversation_id = `extra_meta.clarify_target_conversation_id`(组长会话),而非群会话。

**端到端(手动 / 桩 agent)**
- "帮我写个文档" → 出澄清卡片 → 作答 → 组长派活成员 → 成员结论投影回群,全链路通。

## 八、不在本次范围

- 成员级澄清(成员仍 `enable_hitl=False`,保持自主执行)。
- 二次"计划确认"门(已拍板不做)。
- 澄清轮次硬上限 / 超时自动放弃(由提示词收敛;后续可加)。
- 破坏性 HITL(删除/危险操作 approve)在群里的桥接——本设计仅覆盖澄清(`submit_clarifying_questions`)。

## 九、相关代码索引

| 路径 | 说明 |
| --- | --- |
| `apps/server/src/service/group_room_service.py` | `dispatch_to_leader`、`handle_group_message`、`project_member_conversation_if_in_room`、relay 中继 |
| `apps/server/src/service/chat_service.py` | `approve_trigger`、`resume_conversation_stream` |
| `apps/server/src/service/stream_registry.py` | 中断检测 / `_extract_interrupt_payload` / `approve_and_resume` / `_finalize_task_stream` |
| `apps/server/src/service/hitl_pending_parts.py` | `extract_message_parts_for_interrupt`(中断问题落库为 parts) |
| `apps/server/src/service/agent/orchestrator/agent.py` | 组长 agent + `interrupt_on` + 澄清工具 |
| `apps/server/src/service/agent/destructive_hitl.py` | `build_orchestrator_interrupt_on` |
| `apps/server/src/api/chat_api.py` | `/approve`、`/stream/resume` 端点 |
| `apps/web/src/lib/chat/hitl/` | 前端 HITL / `clarifying-questions` 提交逻辑(群里复用) |
