# 技能单一真相重构：磁盘私有副本为唯一真相，DB 降为派生投影

- 日期：2026-06-25
- 状态：设计已评审通过（用户分段确认）
- 范围：后端 `apps/server`（员工技能存储 / 分配 / 学习闭环写路径）；前端仅展示口径（可选角标）

## 1. 背景与问题

员工的技能当前存在**两个并行的事实源**，会分叉并导致静默数据丢失：

- **档案页「分配技能」** 读 `EmployeeSkill` DB 行（管理台账）。
- **成长履历页「技能」** 读磁盘私有副本 `<skill_path>/<员工id>/skills/<技能>/`（`list_available_skills`，运行时真相）。

二者指向**同一物理目录** `<skill_path>/<员工id>/skills/`（已逐层确认：`_growth_brain_root_for` = `resolve_employee_memories_dir().parent` = `<skill_path>/<员工id>`，分配落盘的 `_save_skills_to_skill_path` 也是 `<skill_path>/<员工id>/skills`），但一个读 DB、一个读磁盘文件夹，写路径割裂：

1. **采纳技能候选**（`adopt_skill_candidate`）只写磁盘 `brain/skills/<slug>/`，**不写 DB** → 采纳后员工能用、履历可见，但**档案看不到**。
2. **分配技能**（`update_employee` → `_save_skills_to_skill_path`）对整个 skills 目录 **`shutil.rmtree` 全量覆盖**，只按 `EmployeeSkill` 集合重建 → **静默删掉**只活在磁盘的成长技能（采纳的、`update_skill` 改进的）。
3. `EmployeeSkill` 与磁盘可任意漂移。

### 运行时权威性

员工 agent 在 `apps/server/src/service/agent/employee.py:84` `list_available_skills(skills_root)` 加载的是**磁盘文件夹**，`EmployeeSkill` DB 行**不参与运行时加载**。因此磁盘私有副本才是运行真相，DB 只是台账。

### 设计目标（用户拍板）

> 技能统一一份。员工技能本就是技能库的 copy 份 → 让**员工私有副本成为该员工技能的唯一真相**，`EmployeeSkill` DB **降为磁盘的单向派生投影**，结构上消除分叉与 rmtree 数据丢失。

注意：**不是**共享工作区技能库（那是总管的加载方式）。每个员工仍各持私有副本，改进天然按员工隔离。

## 2. 核心模型

### 2.1 真相与派生

- **唯一真相 = 磁盘私有副本** `<skill_path>/<员工id>/skills/<技能>/`。agent 运行加载它、`update_skill` 改它、采纳候选写它（均已如此，不变）。
- **`EmployeeSkill` DB 行 = 磁盘的派生投影**。继续服务 7 个消费方（档案展示、总管能力表 `orchestrator/prompts.py:183`、curator 生命周期、`skill_rating_service`、技能-员工同步、`skill_invocation_inference`、`task_api` schedule），但**永远由磁盘单向推导**，业务代码不再独立写 `EmployeeSkill`。
- `EmployeeSkill` 字段（`skill_name_zh` / `skill_description` / `skill_content` 等）由 reconcile **从磁盘 `SKILL.md` + meta 读出填充**。

### 2.2 来源标记（provenance）

每个技能文件夹携带一个**来源标记**，落在该技能 meta 内（随文件夹移动），取值：

- `assigned:<skill_id>` —— 从工作区库 / 远程市场**分配**而来。
- `grown:adopted` —— 采纳技能候选而来。
- `grown:improved` —— 库里没有、纯靠 `update_skill` 在私有副本长出来的独立技能。
- 附加布尔 `locallyModified`（仅对 `assigned:*` 有意义）：该 assigned 技能被 `update_skill` 私下改进过、已与库版本分叉。

标记的唯一用途：让**分配**与**库同步**两个动作知道哪些技能可增删 / 可覆盖、哪些绝不能碰。

> 标记的物理存储（复用 LocalSkillService 的 meta 文件，还是各技能文件夹内新增 `.origin` / `meta.json`）在实现计划阶段最终敲定；要求：跟随文件夹、可被 reconcile 读取、对 `list_available_skills` 透明（不被误当成技能）。

### 2.3 reconcile_employee_skills(employee_id) —— 投影函数（新增，核心）

幂等函数，**唯一**把磁盘投影到 DB：

- 扫 `<skill_path>/<员工id>/skills/` 下每个含 `SKILL.md` 的技能文件夹。
- 磁盘有、DB 无 → **插** `EmployeeSkill` 行（`skill_id` / `source` 从来源标记取，展示字段从磁盘读）。
- DB 有、磁盘无 → **删**行。
- 都有 → 对齐字段。
- 同步刷新 `employee.meta_json` 的技能快照（复用 `_refresh_employee_meta_skills`）。

**任何改动磁盘技能集的操作，末尾调一次它**。DB 结构上不可能再与磁盘分叉。

## 3. 操作改造

### 3.1 分配（update_employee）：全量覆盖 → 增量

替换 `_save_skills_to_skill_path` 的 `rmtree 整目录再重写` 与 `_replace_employee_skills` 的 `删光再重插`：

- 令 `desired` = 用户在档案选定的库 / 远程技能集（`skill_ids` 解析后）。
- **新增**：`desired` 中磁盘尚无的技能 → copy 进私有目录 + 写 `assigned:<id>` 标记。
- **移除**：磁盘上标记为 `assigned:*` 且不在 `desired` 的 → 删该文件夹。
- **不碰**：已在 `desired` 的 assigned 技能（保住已分配状态，**不重新 copy**，从而保住 `locallyModified` 改进版）；以及**所有 `grown:*`**。
- 末尾 `reconcile_employee_skills`。

### 3.2 采纳候选 / update_skill：补一句 reconcile

- `adopt_skill_candidate`：写磁盘后加 reconcile，标记 `grown:adopted` → 档案立刻可见。
- agent 的 `update_skill`（写私有副本）：编辑后加 reconcile；若被编辑的是 `assigned:*` 技能 → 置其 `locallyModified=true`。

### 3.3 库技能同步：私有改进优先（边界 (b)）

`sync_local_skill_to_assignees`（在工作区技能库编辑某技能时，覆盖推送到装了它的员工私有副本）：

- 推送前检查每个 assignee 私有副本：**`locallyModified=true`（或来源已是 `grown:*`）→ 跳过覆盖**，保住该员工的改进版（技能版本允许分叉）。
- 仅推送给未私下改进过的 assignee。
- 推送后对受影响 assignee `reconcile`。

`unassign_local_skill_from_assignees`（删库技能时解绑）：保持现有按技能 rmtree + 删行行为，末尾改为统一走 reconcile。

### 3.4 档案展示

档案「分配技能」继续读 `EmployeeSkill`（现 = 磁盘）。可选：给 `grown:*` 技能打「成长得来」角标，让用户区分库技能 vs 长出来的技能。（纯展示增强，可后置。）

## 4. 老数据迁移（首次 reconcile 自愈）

现存员工私有副本无来源标记。reconcile 遇到无标记文件夹时**回填**：

- 技能名能匹配到该员工现有 `EmployeeSkill` 行（有 `skill_id`）或工作区库技能 → 标 `assigned:<id>`。
- 否则 → 标 `grown:adopted`。

一次性、幂等；无独立迁移脚本，随首次任一 reconcile 触发即可。

## 5. 边界与错误处理

- reconcile 必须容错：单个技能文件夹损坏 / meta 缺失不应中断整体；缺失标记按迁移规则回填。
- 分配增量的「移除」只针对 `assigned:*`，杜绝误删 `grown:*`——这是消除数据丢失的关键不变量，须有专门测试守护。
- 并发：reconcile 与现有 DB 写一样在会话 DB 锁内执行，不引入新并发面。
- `grown:improved` 与 `grown:adopted` 在分配 / 同步逻辑中等价（都不可被库动作增删 / 覆盖）；细分仅为展示与审计。

## 6. 测试（TDD）

先写**失败**用例复现三个 bug，再实现到绿：

1. 采纳候选后 `EmployeeSkill` / 档案接口可见，标记 `grown:adopted`。
2. 已采纳 / 已 `update_skill` 改进的技能存在时，再次分配（增删别的库技能）**不删**这些成长技能。
3. 任一磁盘技能集变更后 `EmployeeSkill` 与磁盘集合一致（reconcile 投影正确）。
4. 库技能编辑同步：`locallyModified` 的 assignee 被跳过、未改进的被更新（边界 (b)）。
5. 迁移：无标记的旧私有副本首次 reconcile 后获得正确来源标记。

## 7. 不做（YAGNI）

- 不删 `EmployeeSkill` 表（7 个消费方，blast radius 太大）。
- 不改总管直接引用工作区库的加载方式。
- 不引入「库版本 → 私有副本」的显式 diff / 刷新 UI（用户接受版本分叉）。
- 「成长得来」角标可后置，不阻塞核心。

## 8. 影响文件（预估，实现计划细化）

- `apps/server/src/service/employee_service.py`：`_save_skills_to_skill_path` / `_replace_employee_skills`（增量化）、`adopt_skill_candidate`、`sync_local_skill_to_assignees` / `unassign_local_skill_from_assignees`、新增 `reconcile_employee_skills`、来源标记读写 helper、迁移回填。
- `apps/server/src/service/agent/update_skill_tool.py`：编辑后 reconcile + 置 `locallyModified`。
- 来源标记存储（meta helper，可能落 `local_skill_service` 或新模块）。
- 测试：`apps/server/tests/` 新增覆盖上述 6 节用例。
- （可选）前端 `growth-brain-section.tsx` / 档案 tab：`grown:*` 角标。
