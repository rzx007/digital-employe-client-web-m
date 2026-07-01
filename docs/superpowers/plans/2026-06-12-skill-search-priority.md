# 需求处理优先级（员工→本地技能→远程技能）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修改总管 System Prompt，强制执行「先查员工 → 再查本地技能 → 最后搜远程」的决策顺序，消除「缺技能优先 SkillsMP」指令与核心原则的矛盾。

**Architecture:** 纯 System Prompt 文本修改，无代码逻辑变更。在 `ORCHESTRATOR_SYSTEM_PROMPT_TEMPLATE` 中新增 `## 需求处理决策链` 节（插入 `## 委派与亲自干` 之后），并将 `## 员工与技能管理` 节中的矛盾行替换为对新节的引用。

**Tech Stack:** Python（字符串模板），无新依赖。

---

### Task 1: 新增 `## 需求处理决策链` 节并修复矛盾行

**Files:**
- Modify: `apps/server/src/service/agent/orchestrator/prompts.py:34` （插入新节）
- Modify: `apps/server/src/service/agent/orchestrator/prompts.py:50` （替换矛盾行）

- [ ] **Step 1: 在第 34 行后插入 `## 需求处理决策链` 节**

在文件 `apps/server/src/service/agent/orchestrator/prompts.py` 中，找到以下文本（第 33-35 行附近）：

```
- 范例：① 微博热搜 → 委派「微博热搜助手」；② 改已建计划的某步 → `update_task`（改优先于删了重建）；③ 没有合适的人 → 问用户「招个新员工，还是我去装个技能？」

## 派活契约（每条子任务 prompt 自包含，员工不用回头猜）
```

在这两节之间插入以下内容（空行保持一致）：

```
- 范例：① 微博热搜 → 委派「微博热搜助手」；② 改已建计划的某步 → `update_task`（改优先于删了重建）；③ 没有合适的人 → 问用户「招个新员工，还是我去装个技能？」

## 需求处理决策链（每次有新需求时严格按此顺序，不得跳步）
1. **查员工**：`list_workspace_employees` — 按已有技能名和岗位描述语义匹配；有合适员工就直接 `create_orchestration_plan` 委派，结束。
2. **查本地技能**：无合适员工时 `list_workspace_skills` — 看已安装技能是否覆盖需求：
   - 有匹配且**已分配**给某员工 → 直接 `create_orchestration_plan` 委派该员工，结束。
   - 有匹配但**未分配**给任何员工 → 提示用户「本地已有「X」技能，要分配给哪个员工？」，等确认后再派，结束。
3. **搜远程技能**：本地也无匹配时，才 `search_market_skills` → `get_market_skill_detail` 预览 → 用户同意 → `install_market_skill` 装 → `update_employee` 分配。SkillsMP 无合适结果时用 `list_builtin_skills` / `install_builtin_skill`。
4. **都无匹配**：问用户「招个新员工，还是装个技能？」，不要编造结果。

**招聘场景同样适用**：`recruit_employee` 前，若已有员工技能或本地技能能满足需求，先告知用户，而非直接生成候选人。

## 派活契约（每条子任务 prompt 自包含，员工不用回头猜）
```

- [ ] **Step 2: 替换 `## 员工与技能管理` 节中的矛盾行**

找到以下文本（在 `## 员工与技能管理` 节内）：

```
- 缺技能优先 SkillsMP：`search_market_skills` 搜 → `get_market_skill_detail` 预览（确认符合需求）→ 用户同意 → `install_market_skill` 装 → `update_employee` 分配。SkillsMP 无合适结果时用 `list_builtin_skills` / `install_builtin_skill`。
```

替换为：

```
- 缺技能时按**需求处理决策链**第 2→3 步操作（先查本地 `list_workspace_skills`，本地无匹配才 `search_market_skills`）。
```

- [ ] **Step 3: 验证文件结构正确**

读取修改后的 `prompts.py`，确认：
1. `## 需求处理决策链` 节存在，位于 `## 委派与亲自干` 节之后、`## 派活契约` 节之前
2. `## 员工与技能管理` 节中不再包含「缺技能优先 SkillsMP」
3. 新节中包含「需求处理决策链」字样，且有编号列表（1. 2. 3. 4.）
4. Python 文件语法正确（字符串未被截断）

- [ ] **Step 4: 提交**

```bash
git add apps/server/src/service/agent/orchestrator/prompts.py
git commit -m "feat(orchestrator): 需求处理决策链——员工→本地技能→远程技能"
```

期望输出：`1 file changed, N insertions(+), 1 deletion(-)`
