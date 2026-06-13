# 员工自造技能体验改造（草稿中转去痛 + skill-creator 普及）设计

- 日期：2026-06-13
- 状态：待评审
- 背景诉求：用户反馈「员工自己造技能」的体验太差——能力被锁在专职员工身上，造出来的技能藏在文件变更卡片的 `+` 图标里没人发现，且就算造了也不会进可复用的本地技能库。

## 1. 问题与根因

### 1.1 现象

- 全机 158 个会话，自动建的 `skills-draft` 占位目录 90 个，**全部为空**；全盘真实存在的草稿技能仅 1 个（`news-hotboard`），且从未被「导入」过。
- 40 个员工里，只有 2 个（内置「技能制作助手」对应的员工 3、7）拥有 `skill-creator`，其余 38 个一个都没有。

### 1.2 根因（两个设计叠加）

1. **造技能能力被锁在专职员工身上**。`skill-creator` 仅 seed 给 `_BUILTIN_SEED_EMPLOYEES`（`apps/server/src/service/employee_service.py:38`）里的「技能制作助手」。普通员工想造技能，只能临场 `write_file` 写一个**裸目录草稿**到会话级 `skills-draft`。
2. **裸目录不是合法正式技能，且转正入口藏起来了**。草稿目录没有 `localId`/`meta.json`，不能被招聘选用、技能库 UI 看不到。要转正得用户在文件变更卡片里点一个不起眼的 `+`「导入到技能库」（`apps/web/src/components/chat/message-blocks/file-change-cards.tsx`），几乎没人发现。

### 1.3 两套技能目录树（关键事实，澄清阶段核实）

| | 路径 | 作用域 | 用途 |
|---|---|---|---|
| **本地技能库** | `~/.digital-employee/local-skills/<workspace_id>/` | 工作区（本机所有员工招聘时可选） | 技能库 UI 展示来源、招聘勾选技能的来源池；远程安装 / 本地导入都进这里 |
| **员工技能** | `~/.digital-employee/employees-skills/<员工ID>/skills/` | 单个员工 | 招聘时按 `localId` 从本地技能库**全量复制**落盘到此；agent 运行时实际加载的就是这里（`_save_skills_to_skill_path`，`employee_service.py:714`） |

- 本地技能库根：`get_default_local_skills_path()` = `~/.digital-employee/local-skills`（`apps/server/src/core/config.py:28`）；按 `workspace_id` 分目录（`LocalSkillService._resolve_local_root`，`local_skill_service.py:79`）。
- 员工技能根：`get_default_skill_path()` = `~/.digital-employee/employees-skills`（`config.py:20`）；按员工 id 分目录。
- 员工的技能配置以**负数 `localId`** 引用本地技能库条目；`update_employee`/`create_employee` 传 `skill_ids` → `_resolve_skills_for_assignment`（`employee_service.py:574`）按 localId 拉技能落盘到员工目录。

**结论**：「保存为技能」正确的归宿是**本地技能库 `local-skills/<workspace_id>/`**（可复用、UI 可见、招聘可选），而不是只丢进某个员工目录。这与「远程安装 / 本地导入」走同一条 `import_local_skill_zip` 链路。

## 2. 目标与范围

### 2.1 本次目标

1. **能力普及**：每个员工（内置 + 招聘的）运行时都能用 `skill-creator` 造技能。
2. **入口可发现**：员工造完技能后，在该轮回复下方挂一张**显眼的「保存为技能」卡片**，取代藏起来的 `+`。
3. **保存语义正确且原子**：点保存 → 一个后端接口原子完成「注册进本地技能库 + 挂到当前对话的员工 + 即时永久可用」。

### 2.2 明确不在本次范围（YAGNI）

- **跨员工共享 / 公共技能库**：保存只入「当前 workspace 的本地技能库 + 当前员工」。本地技能库本身就是工作区级、所有员工招聘可选，已满足复用诉求；不引入新的「公共/全员强制」概念。
- **彻底删除草稿（skills-draft）机制**：草稿作为「本会话临时试用」的缓冲仍保留——它正是「先试用，用户点头才入库」质量门的载体。本次只是把「转正」做顺，不拆缓冲。
- **既有那个 `+` 导入对话框**：保留（它仍是「手动本地导入任意 zip」的通道）；本次新增的是更顺的就地保存卡片。

## 3. 设计

整体分三块：A 能力普及（后端 agent 装配）、B 保存卡片（前端识别 + 渲染）、C 一体化保存接口（后端）。

### 3.A skill-creator 运行时注入（能力普及）

**做法**：在 `get_agent`（`apps/server/src/service/agent/employee.py`）组装 `skill_sources` 时（当前为 `[skills_root] (+ draft_dir)`，见 `employee.py:151-153`），**无条件追加内置 `skill-creator` 的源目录**到每个 agent 的技能加载路径。

- 源目录解析：复用 `LocalSkillService._resolve_packaged_builtin_skills_root()` / `build-in-skills/skill-creator`（已被打包逻辑覆盖，`local_skill_service.py:92`），优先用已 seed 的 `local-skills/builtin/skill-creator`，回退到 `build-in-skills/skill-creator`。封装一个 helper（如 `resolve_builtin_skill_creator_source()`）返回存在的目录，缺失则记日志并跳过（不致命）。
- `available_skills`（注入 system prompt 的清单，`employee.py:61`）需把 `skill-creator` 纳入，否则模型「不知道自己有这个技能」。
- **去重**：若该员工的正式技能库里已经有 `skill-creator`（如员工 3、7），不要重复加载同名源——按技能名去重，保留员工自有的那份。

**取舍（已与用户确认）**：运行时注入，**不**改 `_BUILTIN_SEED_EMPLOYEES`、**不**物理复制进每个 `employees-skills/<员工>/`。一处改动、全员（含存量）生效、零副本、随内置版本自动更新；员工技能配置 UI 不变（不污染）。

### 3.B「保存为技能」卡片（前端）

**触发识别**：当某轮 assistant 消息里出现「写入会话级 `skills-draft/<name>/` 的写文件工具调用」时，视为「员工造了一个草稿技能」。

- 复用现有判定：`getSkillDraftFolder`（`apps/web/src/lib/chat/file-change-utils.ts`）已能从工具调用识别 skills-draft 文件夹并产出 `kind: "skill-folder"` 的 `FileChangeItem`。
- **新增一种消息块** `draft-skill-save`（在 `message-classifier.ts` 的 `ClassifiedBlock` 联合类型与分类逻辑中），由「该轮存在 skill-folder 写入」驱动，携带 `{ skillName, description, draftPath, conversationId }`。description 从草稿 `SKILL.md` frontmatter 解析（复用 `import-draft-skill-dialog.tsx` 里的 `parseSimpleFrontmatter` 思路，抽成共享函数）。
- 在 `block-render-map.tsx` 新增对 `draft-skill-save` 的渲染分支，渲染新组件 `DraftSkillSaveCard`。

**卡片形态**（`apps/web/src/components/chat/message-blocks/draft-skill-save-card.tsx`，新建）：

- 醒目（非藏在文件变更里）：技能图标 + 技能名 + 一句描述 + 主按钮「保存到我的技能库」。
- 状态：未保存 / 保存中 / 已保存（已保存后按钮变为「已加入技能库」禁用态 + 可选「在技能库查看」）。
- 点击 → 调用新接口 `saveDraftSkill`（见 3.C），成功后 toast「技能『X』已保存，当前员工已永久拥有」。
- 不打断对话；用户不点则草稿只在本会话临时有效（现状行为不变）。
- **持久化**：「已保存」状态以本地技能库是否已存在同名技能为准判定（卡片渲染时可据 `localSkillExists` 反映），重载后仍正确显示——不依赖前端易失状态。重复点击已保存的卡片应被前端禁用，且后端接口对已存在同名（无 overwrite）返回 409 作为二次防线。
- **与文件变更卡片的关系**：草稿技能文件夹原本会作为 `skill-folder` 进文件变更面板（改造一里已判为 deliverable）。为避免「同一草稿出现两次」，当某草稿已由 `draft-skill-save` 卡片承载时，文件变更面板中**不再重复展示该 skill-folder 行**（在 `getFileChangesFromUIMessage` 或分类层过滤掉已被保存卡片接管的 skill-folder）。

### 3.C 一体化保存接口（后端）

**新增接口** `POST /skills/local/save-draft`（`apps/server/src/api/skill_api.py`），入参 `{ conversationId, draftPath | skillName, employeeId, overwrite? }`。

内部步骤（全部复用既有逻辑，原子化于一个 service 方法 `LocalSkillService.save_draft_skill(...)` 或 `EmployeeService` 协调）：

1. **定位草稿目录**：由 conversationId + skillName/draftPath 解析出会话级 `skills-draft/<name>/` 真实路径，校验在允许范围内（防穿越）。
2. **打包 + 注册进本地技能库**：把草稿目录打包为 zip，调用既有 `LocalSkillService.import_local_skill_zip(skill_name, ..., workspace_id, overwrite)`（`local_skill_service.py:463`）。它已处理：大小限制、查重/`409 冲突`、`localId` 分配（负数）、`meta.json`（含 `recruitSummary`/`displayNameZh`）、覆盖语义。返回 `localId`。
   - 复用 `import-draft-skill-dialog.tsx` 现在「下载草稿目录为 blob 当 zip」的能力，或在服务端直接对目录打 zip——优先服务端打包，避免前端再下载一遍。
3. **挂到当前员工**：取该员工现有 `skill_ids`，把第 2 步的 `localId` 并入，调用既有 `EmployeeService.update_employee(skill_ids=[...旧, 新localId])`（`employee_service.py:832/864`）。它会 `_resolve_skills_for_assignment` + `_replace_employee_skills` + 重新落盘到 `employees-skills/<员工>/`，使该员工**永久拥有**该技能。
   - 当前会话内本就因草稿在 skill_sources 中而可用；这一步保证**跨会话永久**。
4. 返回 `{ skillName, localId, employeeId, overwritten }`。

**原子性 / 失败处理**：

- 步骤 2 失败（如 409 同名）→ 整体失败，返回错误，前端提示「已存在同名技能，是否覆盖」（带 overwrite 重试）。员工配置不动。
- 步骤 2 成功但步骤 3 失败 → 这是需要重点处理的中间态：技能已入库但没挂上员工。两种兜底（实现时二选一，**推荐 (a)**）：
  - (a) 服务方法内 try：步骤 3 失败时**不回滚入库**（入库本身是用户想要的可复用结果），但返回部分成功标志 `attachedToEmployee: false` + 错误原因；前端提示「已保存到技能库，但挂到当前员工失败，可到员工配置手动添加」。
  - (b) 步骤 3 失败时回滚步骤 2（删除刚注册的技能）。更严格的原子，但要写删除逻辑且可能误删（若 overwrite 覆盖了已有同名技能则无法干净回滚）。**因 (b) 的回滚在 overwrite 场景不安全，采用 (a)。**

**埋点**：本次顺带在该接口加一条 info 日志（技能名 / localId / employeeId / 是否覆盖），补上「草稿转正」这一动作此前完全无日志的空白，便于后续评估使用率。

## 4. 数据流

```
员工对话中需要造技能
  → 运行时已注入 skill-creator（3.A），模型读其 SKILL.md，write_file 到会话级 skills-draft/<name>/
  → 前端识别该轮有 skill-folder 写入（3.B）→ 渲染「保存为技能」卡片
  → 用户点「保存到我的技能库」
  → POST /skills/local/save-draft（3.C）
      1. 定位草稿目录
      2. import_local_skill_zip → 注册进 local-skills/<workspace_id>/，得 localId  ←【入本地技能库，可复用/UI可见/招聘可选】
      3. update_employee(skill_ids += localId) → 落盘到 employees-skills/<员工>/  ←【当前员工永久拥有】
  → 卡片转「已加入技能库」；技能库 UI 与招聘选单下次即可见该技能
```

## 5. 兼容与迁移

- **存量空草稿目录（90 个空 `skills-draft`）**：不在本设计强制清理（属另一独立优化项）；本次不依赖也不破坏它们。
- **既有 `+` 导入对话框 / `import_local_skill_zip` 接口**：完全保留，新接口复用其内核，不改其行为。
- **已拥有 skill-creator 的员工（3、7）**：3.A 的按名去重保证不重复加载，行为不变。
- **DB / schema**：无新增表、无 schema 变更；员工技能仍走既有 `skill_ids` / `skills_json` 机制。

## 6. 测试

后端（`apps/server/tests/`）：

- `save_draft_skill` happy path：草稿目录 → 入 local-skills（localId 生成、meta 写入）→ 员工 skill_ids 含该 localId、员工目录落盘成功。
- 同名冲突：不带 overwrite → 409；带 overwrite → 覆盖成功。
- 部分成功（步骤 3 失败）→ 返回 `attachedToEmployee: false`，技能仍在库。
- 路径穿越：draftPath 含 `..` / 越界 → 拒绝。
- 3.A 注入：`get_agent` 装配后 `available_skills` 含 `skill-creator`；已自有该技能的员工不重复。

前端：

- `message-classifier` 对「该轮含 skills-draft 写入」产出 `draft-skill-save` 块；不含时不产出。
- 文件变更面板不再重复展示已被保存卡片接管的 skill-folder。
- `DraftSkillSaveCard` 三态渲染与点击调用 `saveDraftSkill`（mock）。

## 7. 涉及文件清单

后端：
- `apps/server/src/service/agent/employee.py` — 3.A 注入 skill-creator 到 skill_sources + available_skills
- `apps/server/src/service/local_skill_service.py` 或新协调方法 — 3.C `save_draft_skill`（打包草稿 + 复用 import + 挂员工）
- `apps/server/src/api/skill_api.py` — 3.C 新接口 `POST /skills/local/save-draft`
- `apps/server/src/schemas/` — 新接口请求/响应 schema
- `apps/server/tests/` — 上述测试

前端：
- `apps/web/src/lib/chat/message-classifier.ts` — 新 `draft-skill-save` 块类型与分类
- `apps/web/src/lib/chat/file-change-utils.ts` — 过滤已被保存卡片接管的 skill-folder
- `apps/web/src/components/chat/message-blocks/block-render-map.tsx` — 渲染分支
- `apps/web/src/components/chat/message-blocks/draft-skill-save-card.tsx` — 新建卡片组件
- `apps/web/src/api/skill.ts` — `saveDraftSkill` 客户端调用
- 共享 frontmatter 解析（从 `import-draft-skill-dialog.tsx` 抽出）

## 8. 风险

- **3.A 运行时注入路径解析**：打包（PyInstaller）与开发环境下 `build-in-skills/skill-creator` 路径不同；必须复用既有 `_resolve_packaged_builtin_skills_root()` 的多候选回退，并在缺失时优雅跳过（不阻断 agent 启动）。
- **草稿打包一致性**：服务端对草稿目录打 zip 要与 `import_local_skill_zip` 期望的目录结构（`_detect_skill_source_root`）一致，否则注册失败。实现时以一个真实草稿（如 `news-hotboard`，含 `scripts/`）跑通为准。
- **重复展示**：保存卡片与文件变更面板都可能呈现同一草稿，需在分类层去重（3.B 已规定），否则用户看到两处。
