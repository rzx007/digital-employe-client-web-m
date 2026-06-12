# 需求处理优先级：员工 → 本地技能 → 远程技能

**日期**：2026-06-12  
**范围**：`apps/server/src/service/agent/orchestrator/prompts.py`  
**类型**：System Prompt 优化

---

## 背景

当前总管 System Prompt 在「员工与技能管理」节中有一行：

> 缺技能优先 SkillsMP：`search_market_skills` 搜 → …

这与「核心原则」中「有人先派人 → 没人看自己 → 都没有就建议」的精神矛盾——AI 在发现技能缺口时会直接跳向远程搜索，跳过了本地已安装技能的检查步骤。

---

## 需求

每次收到用户需求时，按以下优先级决策：

1. **先查员工**：已有员工（按技能名 OR 岗位描述语义）能处理 → 直接派
2. **再查本地技能**：没有合适员工 → 查本地已安装技能
   - 已分配给员工 → 直接派
   - 未分配 → 提示用户「本地已有 X 技能，要分配给哪个员工？」
3. **最后搜远程**：本地也无匹配 → 搜 SkillsMP
4. **都没有** → 问用户招人 or 装技能

招聘场景同样适用。

---

## 设计

### 变更 1：新增 `## 需求处理决策链` 节

插入位置：`## 委派与亲自干` 之后、`## 派活契约` 之前。

```
## 需求处理决策链（每次有新需求时严格按此顺序，不得跳步）
1. **查员工**：`list_workspace_employees` — 按已有技能名和岗位描述语义匹配；有合适员工就直接 `create_orchestration_plan` 委派，结束。
2. **查本地技能**：无合适员工时 `list_workspace_skills` — 看已安装技能是否覆盖需求：
   - 有匹配且**已分配**给某员工 → 直接 `create_orchestration_plan` 委派该员工，结束。
   - 有匹配但**未分配**给任何员工 → 提示用户「本地已有「X」技能，要分配给哪个员工？」，等确认后再派，结束。
3. **搜远程技能**：本地也无匹配时，才 `search_market_skills` → `get_market_skill_detail` 预览 → 用户同意 → `install_market_skill` 装 → `update_employee` 分配。SkillsMP 无合适结果时用 `list_builtin_skills` / `install_builtin_skill`。
4. **都无匹配**：问用户「招个新员工，还是装个技能？」，不要编造结果。

**招聘场景同样适用**：`recruit_employee` 前，若已有员工技能或本地技能能满足需求，先告知用户，而非直接生成候选人。
```

### 变更 2：修改 `## 员工与技能管理` 节

**原文**（第 50 行）：
> 缺技能优先 SkillsMP：`search_market_skills` 搜 → `get_market_skill_detail` 预览（确认符合需求）→ 用户同意 → `install_market_skill` 装 → `update_employee` 分配。SkillsMP 无合适结果时用 `list_builtin_skills` / `install_builtin_skill`。

**替换为**：
> 缺技能时按**需求处理决策链**第 2→3 步操作（先查本地 `list_workspace_skills`，本地无匹配才 `search_market_skills`）。

---

## 决策说明

| 设计选择 | 理由 |
|---|---|
| 新增专节，不改核心原则 | 核心原则是精神总纲；专节提供操作级细节，职责分离 |
| 编号列表而非文字描述 | 明确顺序，LLM 更难忽略 |
| 区分「已分配/未分配」两分支 | 强制走用户确认路径，避免 LLM 自行决定是否分配 |
| 招聘场景一句补充即可 | 无需单独新节，保持 prompt 紧凑 |

---

## 不在范围内

- 不修改任何 Python 业务逻辑
- 不修改工具函数签名
- 不修改招聘生成算法（`employee_generation_service.py`）
