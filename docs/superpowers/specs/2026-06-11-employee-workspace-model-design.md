# 员工工作空间模型：产物升级到员工级 + 全局公共区

> 设计稿 · 2026-06-11 · 方案 A（员工工作空间根 + 按会话分子目录 + 全局公共区）

## 0. 前提与关系

本设计**建立在已合并的「去虚拟路径 → 真实路径 + env 注入」之上**
（见 [2026-06-11-remove-virtual-paths-design.md](2026-06-11-remove-virtual-paths-design.md)）。
那次把寻址改成真实绝对路径 + `$ARTIFACTS_DIR` 等环境变量；**本次只改这些目录的「作用域」**
（会话级 → 员工级），并新增一个全局公共区。不回退真实路径方向。

---

## 1. 背景与目标

### 1.1 现状的割裂

| 数据 | 当前作用域 | 物理位置 |
|------|-----------|----------|
| 技能 skills | **员工级**（跨会话） | `skill_path/<employee_id>/skills/` |
| 记忆 memories | **员工级**（跨会话） | `skill_path/<employee_id>/memories/` |
| 产物 artifacts | **会话级** | `artifacts_path/<conversation_id>/artifacts/` |
| 上传 uploads | **会话级** | `artifacts_path/<conversation_id>/uploads/` |
| 群协作产物 | **房间级** | `artifacts_path/room-<room_id>/artifacts/` |

技能/记忆已是员工级，**唯独产物是会话级**——这是核心割裂。代码里已有一条"员工级 artifacts"
兜底分支（无会话时用 `skills_root.parent/artifacts`），但有会话就分叉到会话目录。

### 1.2 两个问题（不同轴）

1. **同一员工跨会话**：员工 X 会话 1 产出的 report.md，会话 2 看不到，无法在自己过去的成果上继续。
2. **跨员工传递**：员工 A 的产物要给员工 B 用——目前只有"群房间"一条共享通道，日常直聊无法传递。

### 1.3 目标

1. **一个员工一个工作空间**：产物升到员工级（与技能/记忆一致），跨会话可读可漫游 → 解决问题 1。
2. **全局公共区**：一个工作空间级的公共目录，所有员工直接读写，用于跨员工沉淀/传递 → 解决问题 2。
3. 不撞名、不堆成垃圾堆：员工工作空间内**按会话分子目录**组织。

### 1.4 非目标（YAGNI）

- 不改技能/记忆的位置（已是员工级）。
- 不动群房间机制（`room-<room_id>/artifacts` 维持，作"一次性协作的临时共享区"）。
- 不引入权限/ACL（公共区是全员可读写的平摊目录；单机桌面、单用户，先不做细粒度授权）。
- 不引入文件级元数据库（出处用"会话子目录"天然表达，不另建索引——保持轻量）。

---

## 2. 目录模型（方案 A）

```
<artifacts_root>/                                  (settings.artifacts_path)
├── shared/                                        ← 全局公共区根  $PUBLIC_ROOT（读：面向整个 shared/**）
│   └── employee-<id>/conv-<cid>/                  ← 该会话的共享产物  $PUBLIC_DIR（写：自己往这放）
├── employee-<id>/
│   └── artifacts/                                 ← 员工工作空间根  $WORKSPACE_DIR（整根可读）
│       ├── conv-<conversation_id>/                ← 当前会话产物  $ARTIFACTS_DIR（= cwd，写新产物落这）
│       │   └── uploads/                           ← 本会话上传  $UPLOADS_DIR
│       ├── conv-<other_id>/ …                     ← 过去会话产物（可 read_file 漫游）
│       └── （agent 也可自建 topic 子目录）
└── room-<room_id>/artifacts/                      ← 群协作临时共享区（不变）

技能/记忆（不变，已是员工级）：
skill_path/<employee_id>/{skills, memories}/       $SKILLS_DIR / $MEMORIES_DIR
```

> **公共区按来源分层（做法 A）**：每个会话往 `$PUBLIC_DIR`（= `shared/employee-<id>/conv-<cid>/`）写自己的
> 共享产物；要看别人共享的，读 `$PUBLIC_ROOT`（整个 `shared/**`）。好处：① 删会话/员工时其公共副本**天然级联**
> （连删对应子目录）；② 不同员工同名共享互不覆盖；③ 无需元数据库，shell `cp` 进去的也照样级联。工作台展示时把
> `shared/**` 拍平成一个"公共区"列表（条目带来源标签）。

### 2.1 注入的环境变量（在 §去虚拟路径 已注入的基础上增改）

| env | 含义 | 值 |
|-----|------|-----|
| `$ARTIFACTS_DIR` | **当前会话**产物目录（cwd，写新产物） | `…/employee-<id>/artifacts/conv-<id>/` |
| `$WORKSPACE_DIR` | **员工工作空间根**（读自己跨会话的全部产物） | `…/employee-<id>/artifacts/` |
| `$PUBLIC_DIR` | **写**：把成果共享出去（按来源分层，自动级联/防撞名） | `…/shared/employee-<id>/conv-<id>/` |
| `$PUBLIC_ROOT` | **读**：浏览/取用所有人共享的 | `…/shared/` |
| `$UPLOADS_DIR` | 本会话上传 | `…/conv-<id>/uploads/` |
| `$SKILLS_DIR` / `$SKILLS_DRAFT_DIR` / `$MEMORIES_DIR` | 同前（不变） | 同前 |

> `$ARTIFACTS_DIR` 仍是 agent 写交付物的默认落点，shell cwd 即此——**对 agent 的"写"心智模型零变化**；
> 新增的是"读过去/读公共"两个可选维度（`$WORKSPACE_DIR`、`$PUBLIC_DIR`）。

---

## 3. 各 agent 上下文的目录解析

`get_agent` / `get_orchestrator_agent` 构造时按上下文解析三个目录（替换现有 `artifacts_dir` 单值逻辑）：

| 上下文 | `$ARTIFACTS_DIR`（写产物） | `$WORKSPACE_DIR`（读自己） | `$PUBLIC_DIR`（写共享） | `$PUBLIC_ROOT`（读公共） |
|--------|----------------------|--------------------------|------------------------|------------------------|
| **员工直聊** | `employee-<id>/artifacts/conv-<cid>/` | `employee-<id>/artifacts/` | `shared/employee-<id>/conv-<cid>/` | `shared/` |
| **员工无会话**（兜底） | `employee-<id>/artifacts/_scratch/` | `employee-<id>/artifacts/` | `shared/employee-<id>/_scratch/` | `shared/` |
| **群房间成员** | `room-<rid>/artifacts/`（协作产出落共享） | `employee-<id>/artifacts/`（仍可读自己） | `shared/employee-<id>/conv-<cid>/` | `shared/` |
| **总管 orchestrator** | `employee-orchestrator/artifacts/conv-<cid>/` | `employee-orchestrator/artifacts/` | `shared/employee-orchestrator/conv-<cid>/` | `shared/` |

要点：
- **群房间**：当前任务产出仍落 `room-<rid>/artifacts`（保持协作可见），但成员**额外**能读自己工作空间与公共区。
- **总管**当作一个特殊"员工"（id=`orchestrator`），同样有工作空间 + 公共区。
- 沙箱根（见 §4）随之是这三者的并集。

---

## 4. 作用域与沙箱

资源读取/静态服务/下载的沙箱边界从"会话目录"**放宽到三个允许根的并集**：

```
读 allowed_roots = [
  employee-<id>/artifacts/   (员工自己工作空间，含所有 conv-*)
  shared/                    (公共区根 $PUBLIC_ROOT，可读所有人共享)
  room-<rid>/artifacts/      (若在房间上下文)
]
写 allowed_roots = [
  employee-<id>/artifacts/conv-<cid>/   (当前会话产物 + uploads)
  shared/employee-<id>/                  (只能往自己的公共子区写/删)
  room-<rid>/artifacts/                  (房间上下文)
]
路径合法 ⟺ resolve() 落在对应（读/写）allowed_root 内
```

- `_resolve_safe_path` / `_bucket_of` / `_resolve_conversation_dir`（`resource_service.py`）改为按上述读/写根解析，而非单会话目录。
- **读公共**面向整个 `shared/**`；**写公共**只能写自己的 `shared/employee-<id>/…`（防越权改别人共享）。
- 跨员工隔离：员工 B **不能**直接读 A 的私有工作空间（`employee-<A>/artifacts/`）——A→B 必须经公共区。但
  公共区 `shared/**` 全员可读。
- **删公共**：见 §7.3，`shared/` 内任意路径可删（无 ACL，平摊）；删自己会话/员工时其 `shared/employee-<id>/…`
  子区**级联删**（§7.1）。

---

## 5. prompt 指引（员工/总管文件工具一节增补）

在已去虚拟路径的文案上加三句：

- **交付物**：写到产物目录（cwd / `$ARTIFACTS_DIR`），与现在一致。
- **找自己过去的活**：在 `$WORKSPACE_DIR` 下按会话子目录（`conv-*`）翻；要复用旧产物先 `ls $WORKSPACE_DIR` 再 read。
- **共享给别的员工**：复制/写到 `$PUBLIC_DIR`（这是你自己的共享区，会随会话/你的删除自动清理）。
- **取用别人共享的**：浏览/读 `$PUBLIC_ROOT`（所有人的共享都在这下面，按 `employee-*/conv-*/` 分）。

---

## 6. 资源服务 / API / 工作台

### 6.1 资源列举（`ResourceService.list_resources`）

从"列举单会话"改为列举**员工工作空间 + 公共区**（房间上下文额外列房间）：

```
ResourceList {
  artifacts:    员工工作空间下【当前会话】子目录（默认聚焦视图）
  workspace:    员工工作空间全树（按 conv-* 分组；新字段，供"漫游全部"）
  public:       公共区 shared/** 拍平（新字段；条目带来源 employee/conv 标签）
  uploads:      当前会话上传
  skills_draft: 同前
  room?:        房间共享（房间上下文）
}
```
（沿用去虚拟路径的 `{path: 真实路径, bucket}` 条目形态；`bucket` 增加 `workspace` / `public` 值。）

### 6.2 工作台 UX（apps/web）

- **默认聚焦**：仍以"当前会话产物"为主视图（用户心智不突变）。
- **新增两个折叠区**：「本员工工作空间（全部会话）」「公共区」——可展开漫游。
- 分桶逻辑（`getResourceBucket` 段匹配）已能识别真实路径里的 `artifacts/conv-*`、`shared/` 段；
  P3 的目录归属推导继续复用，只是多两个桶根。
- 预览/下载/删除走真实路径 + §4 放宽后的沙箱。

### 6.3 上传

上传仍写当前会话 `conv-<id>/uploads/`（会话输入，不跨会话沉淀）。`upload_file` 落点改为工作空间下的会话子目录。

---

## 7. 删除与生命周期（含批量管理）

产物升到员工级后，"删会话"与"删产物"是两个不同动作，需明确联动语义；并支持批量。

### 7.1 删单个会话（级联默认删产物，可选保留）

删会话时联动四件事：① 会话记录（DB）② LangGraph checkpoint ③ 该会话产物目录
`employee-<id>/artifacts/conv-<conversation_id>/`（含 `uploads/`）④ 该会话的公共副本子区
`shared/employee-<id>/conv-<conversation_id>/`。

- **默认级联删产物（含公共副本）**。删除前弹确认框（N 含工作空间 + 公共区两处计数）：
  > 「此会话有 **N** 个产物（含 **P** 个已共享到公共区）。 [删除会话和全部产物] / [只删会话，保留产物] / 取消」
- 选「只删会话，保留产物」→ 仅删会话记录 + checkpoint；`conv-<id>/` 与 `shared/…/conv-<id>/` 都留下成为
  **孤立产物**（工作台"工作空间全部 / 公共区"视图仍可见、可后续单独清理）。
- **公共副本天然级联**（做法 A）：因公共区按 `shared/employee-<id>/conv-<id>/` 分层，删会话只需连删该子目录，
  无需查表、无漏网。
- 群房间产物（`room-<rid>/artifacts`）不随成员单个会话删除而动（房间有独立生命周期）。
- **删除员工（解雇）**：级联删该员工整个工作空间 `employee-<id>/artifacts/` 与公共子区 `shared/employee-<id>/`。

### 7.2 批量删会话

会话列表多选 → 批量删。级联选择**作用于整批**（一个确认框）：
> 「删除 **M** 个会话及其 **K** 个产物？ [删会话和产物] / [只删会话，保留产物] / 取消」

复用并扩展现有 `ChatService.adelete_conversations_by_target`（按 target 批量删）：增加"是否级联删产物"参数，
按会话→员工映射解析各自 `conv-<id>/` 目录后删除。

### 7.3 批量删产物

工作台内多选文件/文件夹（当前会话 / 工作空间全部 / 公共区）→ 批量删。

- 资源 API 增**批量删除端点**：收一组真实路径，**逐条按 §4 沙箱校验**（必须在该员工工作空间或公共区或房间内），
  合法则删、非法则跳过并回报；返回 `{deleted: [...], skipped: [...]}`。
- 删**目录**（如整个 `conv-<id>/` 或某 topic 子目录）= 递归删（沿用 `delete_resource` 的 rmtree，已有桶根校验）。
- **公共区批量删**：允许（无 ACL），但属"影响所有员工"的操作，工作台二次确认提示其公共性。

### 7.4 沙箱与越权

所有删除（单/批、会话联动/产物）统一走 §4 沙箱：员工 B 不能删 A 私有工作空间的产物；写/删公共只限自己的
`shared/employee-<B>/…` 子区（**经工作台手动删**公共项可放宽到整个 `shared/`，无 ACL）。删会话联动时，按该会话所属
员工解析其 `employee-<id>/artifacts/conv-<id>/` 与 `shared/employee-<id>/conv-<id>/` 两处，不跨员工。

---

## 8. 迁移

存量 `artifacts_path/<conversation_id>/artifacts/`（旧的会话级布局）：

- **方案（推荐）惰性兼容**：新会话用新布局；资源解析时，若员工工作空间下找不到该会话子目录，回退到旧 `artifacts_path/<conversation_id>/` 读取（只读兼容）。不做一次性搬迁，降低风险。
- 备选：启动时一次性把旧 `<conversation_id>/artifacts` 搬到对应 `employee-<id>/artifacts/conv-<id>/`——需会话→员工映射（DB 有），但有失败/中断风险，单机桌面不值当。
- **暂定惰性兼容**，§8 Q1 待定夺。

---

## 9. 开放问题（review 时定夺）

- **Q1 迁移策略**：惰性只读兼容旧布局（推荐）vs 启动一次性搬迁。**暂定惰性**。
- ~~**Q2 公共区命名冲突**~~ **已定（做法 A）**：公共区按 `shared/employee-<id>/conv-<cid>/` 分层，写各自子区，
  天然不撞名、且支持级联删（见 §2「公共区按来源分层」、§7.1）。读面向整个 `shared/**`。
- **Q3 总管工作空间**：总管是否需要独立工作空间，还是只读公共区 + 各员工产物汇总？**暂定给总管独立工作空间**（id=orchestrator），与员工一致。
- **Q4 房间与工作空间的关系**：房间产物结束后是否自动沉淀到参与者工作空间或公共区？**暂定不自动**（房间是临时区，要留存由 agent/用户显式复制到公共区）。
- **Q5 跨员工读权限**：是否允许员工**只读**别人的私有工作空间（不经公共区）？**暂定否**（私有=私有，共享必经公共区），保持清晰隔离边界。
- **Q6 工作台默认展示范围**：默认只显当前会话 vs 默认显整个工作空间。**暂定默认当前会话 + 可展开全工作空间/公共区**。
- **Q7 删会话级联默认**：默认级联删产物 + 弹框可选保留（已定，见 §7.1）。仅复述：默认删、可保留。
- **Q8 孤立产物清理**：「只删会话保留产物」积累的孤立 `conv-<id>/` 是否需要专门的"孤立产物"过滤/一键清理入口，还是混在工作空间视图里手动批量删即可？**暂定后者**（不单独做孤立视图，靠 §7.3 批量删）。

---

## 10. 受影响范围（实现时细化为分相位计划）

**服务端**：
- `agent/employee.py`、`agent/orchestrator/agent.py`：artifacts_dir 单值 → `$ARTIFACTS_DIR`/`$WORKSPACE_DIR`/`$PUBLIC_DIR`(写自己公共子区)/`$PUBLIC_ROOT`(读全部) 解析；按上下文建 `shared/employee-<id>/conv-<cid>/`；env 注入（`skill_shell_backend.py`）。
- `resource_service.py`：`_resolve_conversation_dir` → 员工工作空间根解析；沙箱放宽到三根并集；`list_resources` 增 workspace/public；upload 落点改会话子目录；迁移兼容回退。
- `api/chat_api.py`：资源端点沙箱/作用域调整；**新增批量删除产物端点**（收路径数组，逐条沙箱校验，§7.3）。
- `schemas/resource.py`：`ResourceList` 增 `workspace`/`public` 字段，`bucket` 增值。
- `service/chat_service.py`：会话删除（单/批）增"级联删产物"参数，按会话→员工解析 `conv-<id>/` 目录删除（§7.1/7.2）。
- prompt：`prompts.py`/`prompt_rules.py`/`orchestrator/prompts.py`/`AGENTS.md` 增 §5 三句。

**前端**：
- `pending-resources/paths.ts`：bucket 增 `workspace`/`public` 识别（段匹配）。
- `artifact-panel.tsx`：新增"工作空间全部"「公共区」折叠区；**产物多选 + 批量删 UI**（含公共区二次确认）。
- 会话列表组件：**多选 + 批量删 + 级联确认框**（§7.1/7.2）。
- `merge.ts`、`conversation.ts`(api)：消费新 ResourceList 字段；批量删除调用。

**测试**：目录解析三上下文、沙箱并集校验、跨员工隔离（B 读不到/删不到 A 私有、能读公共）、迁移回退、资源列举新字段；**删会话级联删产物 / 保留产物两路径、批量删会话+产物、批量删按沙箱跳过非法路径**。

**迁移/兼容**：旧会话级 artifacts 只读回退。
