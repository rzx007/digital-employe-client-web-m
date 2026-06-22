# 总管对话支持 Slash Command — 设计文档

> 日期：2026-06-22 ｜ 分支：`feat/orchestrator-centric`
> 目标：让总管（orchestrator/curator）主对话也支持斜杠命令，与员工对话对齐，但承载总管专属语义。

## 1. 背景与动机

斜杠命令（`/` 触发命令菜单）目前**只在员工对话**生效。整条前端链路是**总管与员工共用**的：

```
ChatPromptInput → LexicalPromptInputTextarea → slash-command-plugin → CommandPillNode
```

区别仅在传入的 `slashCommands` 数据：

- 员工对话：[chat-panel.tsx:242](../../../apps/web/src/components/chat/panel/chat-panel.tsx) 把该员工的技能映射成命令。
- 总管对话：[curator-view.tsx:951](../../../apps/web/src/components/chat/curator/curator-view.tsx) 硬编码 `slashCommands={[]}`。

后端侧，总管 agent 构建时**已经**通过 `create_deep_agent(skills=...)` 加载了 `orchestrator_skills/`（固定）与 `local-skills/<workspace_id>`（工作区）两处技能（[agent.py:189-207](../../../apps/server/src/service/agent/orchestrator/agent.py)），但 stream 接口对 `skill` 参数的注入逻辑在 [chat_service.py:767](../../../apps/server/src/service/chat_service.py) **显式排除了 curator**（`if skill_name and target_type != "curator"`）。

因此本功能**不需要新建技能存储**，主要是「把已有能力暴露到斜杠菜单 + 放开 curator 的 skill 注入」。

## 2. 功能范围

总管斜杠菜单并存**两类**命令，靠 `SlashCommandItem.kind` 区分：

| 类型 | `kind` | 来源 | 选中后行为 |
|------|--------|------|-----------|
| 总管技能 | `"skill"` | 后端新增接口列出 `orchestrator_skills/` 固定目录 | 沿用员工链路：把 `command.title` 作为 `skill` 参数发后端，后端拼「请使用X技能…」前缀 |
| 快捷指令 | `"shortcut"` | 前端硬编码的预设模板常量 | 把预写 `prompt` 作为消息正文发给总管（`skill=""`），后端无感知 |

**明确不做（YAGNI）：**
- 不把 `local-skills/<workspace_id>` 全量铺进菜单——总管以调度为主，只暴露固定的几个基础技能。
- 快捷指令不落后端存储、不做可配置指令库——纯前端常量。
- 快捷指令不触发独立后端 endpoint——都走 agent 的现有工具能力。

## 3. 数据流

```
用户输入 "/" → 菜单（技能组 + 快捷指令组，带分组标题）
  ├─ 选「技能」  → CommandPill → 发送 { skill: title, text: 用户补充文字 }
  │                 → 后端 chat_service 拼「请使用{title}技能回答这个问题：{text}」
  │                 → 总管 agent 加载并使用该技能
  └─ 选「快捷指令」→ CommandPill → 发送 { skill: "", text: 模板prompt + 用户补充文字 }
                    → 后端原样把正文交给总管，总管用现有工具处理
```

## 4. 后端设计

### 4.1 新增：列出总管技能接口

- **路由**：`GET /chat/orchestrator/skills`（挂在现有 chat/curator 相关路由模块）。
- **返回**：`list[{ name: str, description: str }]`。
- **实现**：
  - `skills_root = resolve_orchestrator_skills_root()`（已有，[paths.py:47](../../../apps/server/src/service/agent/paths.py)）
  - `names = list_available_skills(skills_root)`（已有，仅含有 `SKILL.md` 的目录）
  - 逐个用 `LocalSkillService._extract_description_from_skill_md(skill_dir / "SKILL.md")`（已有，[local_skill_service.py:301](../../../apps/server/src/service/local_skill_service.py)）读 frontmatter 描述；解析失败降级为空串。
- **不含** `local-skills`。

### 4.2 修改：放开 curator 的 skill 注入

[chat_service.py:767](../../../apps/server/src/service/chat_service.py)：

```python
# 现状（curator 被排除）
if skill_name and target_type != "curator":
    skill_question = f"请使用{skill_name}技能回答这个问题：{question}"

# 改为（curator 与 employee 一致处理）
if skill_name:
    skill_question = f"请使用{skill_name}技能回答这个问题：{question}"
```

> 总管 agent 已把 `orchestrator_skills/` 作为可加载技能（`create_deep_agent(skills=...)`），故「请使用X技能」能被真实加载执行。注意 employee 专属的「技能预路由软提示」分支（`target_type == "employee"` 且未显式 skill）不变——curator 不参与自动预路由。

## 5. 前端设计

### 5.1 `SlashCommandItem` 扩展

在 [slash-command-plugin.tsx](../../../apps/web/src/components/lexical-editor/slash-command-plugin.tsx) 的 `SlashCommandItem` 接口增可选字段（向后兼容，员工不传则默认按技能处理）：

```ts
interface SlashCommandItem {
  id: string
  title: string
  icon?: React.ReactNode
  description?: string
  keywords?: string[]
  kind?: "skill" | "shortcut"   // 新增，默认 "skill"
  prompt?: string               // 新增，仅 shortcut 用
}
```

### 5.2 `curator-view.tsx`

- 用 TanStack Query 拉取 `GET /chat/orchestrator/skills`，映射成 `kind: "skill"` 的 `SlashCommandItem[]`（title=技能名、description=技能描述、icon=`IconSparkles`）。
- 本地常量定义 7 条 `kind: "shortcut"` 的快捷指令（icon 用区别于技能的图标，如 `IconBolt`）。
- 合并两组传给 `ChatComposerArea` 的 `slashCommands`（替换 [第951行](../../../apps/web/src/components/chat/curator/curator-view.tsx) 的 `[]`）。快捷指令组排在技能组之上。

### 5.3 发送分支

curator-view 的发送 handler（现 [565-574 行](../../../apps/web/src/components/chat/curator/curator-view.tsx) 一带）按 `command.id` 回查完整 item：

```ts
const item = slashCommands.find((c) => c.id === command?.id)
if (item?.kind === "shortcut") {
  messageText = [item.prompt, messageText].filter(Boolean).join("\n")
  skillParam = ""
} else {
  skillParam = command?.title ?? ""
}
```

### 5.4 菜单分组

slash-command-plugin 的 FloatingMenu 渲染时按 `kind` 分两组、各带分组标题（「快捷指令」「总管技能」）。技能空时该组隐藏。

## 6. 快捷指令清单（最终 7 条）

| 指令标题 | prompt 模板 |
|----------|------------|
| 查看进度 | 请汇报当前所有进行中编排计划的进度，逐项列出各子任务状态。 |
| 汇总交付物 | 请汇总当前计划已产出的全部交付物，列出文件清单与所在位置。 |
| 团队复盘 | 请基于近期已完成的任务，复盘团队整体表现，指出做得好的与可改进的点。 |
| 团队与能力 | 请列出当前团队成员及各自能力画像，帮我判断谁适合接下来的任务。 |
| 质检返工 | 请对最近完成的子任务交付物做一次质检，对不达标的安排返工。 |
| 缺口诊断 | 评估接下来的任务是否缺人或缺技能，需要就建议招人或去技能市场装技能。 |
| 取消计划 | 请取消当前进行中的编排计划。 |

## 7. 测试

**后端**
- 新接口：空目录返回 `[]`；多技能返回名称列表；某技能 `SKILL.md` 无 frontmatter → description 降级空串。
- chat_service 注入：`target_type="curator"` + `skill_name` → 问题被正确前缀；employee 行为不回归。

**前端**
- curator-view 两组命令合并渲染、分组标题正确；技能为空时仅渲染快捷指令组。
- 发送分支：选 shortcut → 正文含模板 prompt 且 `skill=""`；选 skill → `skill=title`、正文不含模板。

## 8. 影响面与回归边界

- 员工对话：`SlashCommandItem` 新增字段均可选，不传即旧行为；`chat_service` 改动仅去掉 `!= "curator"` 守卫，employee 分支语义不变（employee 本来就满足 `target_type != "curator"`）。
- 不触碰确认门、DAG 调度、学习闭环等总管核心不变量（架构文档 §7）。

## 9. 不变量校验

- **唯一对话面**：快捷指令仍是用户→总管的对话输入，不绕过总管。
- **技能复用优先**：复用已加载的 `orchestrator_skills/`，不新建并行存储。
- **不自爆内部机制**：快捷指令模板用人话描述诉求，由总管内部用工具实现，不暴露内部规则。
