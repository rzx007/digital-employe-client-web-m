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
├── shared/                                        ← 全局公共区  $PUBLIC_DIR（所有员工读写）
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

### 2.1 注入的环境变量（在 §去虚拟路径 已注入的基础上增改）

| env | 含义 | 值 |
|-----|------|-----|
| `$ARTIFACTS_DIR` | **当前会话**产物目录（cwd，写新产物） | `…/employee-<id>/artifacts/conv-<id>/` |
| `$WORKSPACE_DIR` | **员工工作空间根**（读自己跨会话的全部产物） | `…/employee-<id>/artifacts/` |
| `$PUBLIC_DIR` | **全局公共区**（跨员工读写共享） | `…/shared/` |
| `$UPLOADS_DIR` | 本会话上传 | `…/conv-<id>/uploads/` |
| `$SKILLS_DIR` / `$SKILLS_DRAFT_DIR` / `$MEMORIES_DIR` | 同前（不变） | 同前 |

> `$ARTIFACTS_DIR` 仍是 agent 写交付物的默认落点，shell cwd 即此——**对 agent 的"写"心智模型零变化**；
> 新增的是"读过去/读公共"两个可选维度（`$WORKSPACE_DIR`、`$PUBLIC_DIR`）。

---

## 3. 各 agent 上下文的目录解析

`get_agent` / `get_orchestrator_agent` 构造时按上下文解析三个目录（替换现有 `artifacts_dir` 单值逻辑）：

| 上下文 | `$ARTIFACTS_DIR`（写） | `$WORKSPACE_DIR`（读自己） | `$PUBLIC_DIR` |
|--------|----------------------|--------------------------|---------------|
| **员工直聊**（有 employee_id + conversation_id） | `employee-<id>/artifacts/conv-<cid>/` | `employee-<id>/artifacts/` | `shared/` |
| **员工无会话**（兜底） | `employee-<id>/artifacts/_scratch/` | `employee-<id>/artifacts/` | `shared/` |
| **群房间成员**（shared_artifacts_dir 存在） | `room-<rid>/artifacts/`（协作产出落共享） | `employee-<id>/artifacts/`（仍可读自己） | `shared/` |
| **总管 orchestrator** | `employee-orchestrator/artifacts/conv-<cid>/` | `employee-orchestrator/artifacts/` | `shared/` |

要点：
- **群房间**：当前任务产出仍落 `room-<rid>/artifacts`（保持协作可见），但成员**额外**能读自己工作空间与公共区。
- **总管**当作一个特殊"员工"（id=`orchestrator`），同样有工作空间 + 公共区。
- 沙箱根（见 §4）随之是这三者的并集。

---

## 4. 作用域与沙箱

资源读取/静态服务/下载的沙箱边界从"会话目录"**放宽到三个允许根的并集**：

```
allowed_roots = [
  employee-<id>/artifacts/   (员工工作空间，含所有 conv-*)
  shared/                    (公共区)
  room-<rid>/artifacts/      (若在房间上下文)
]
路径合法 ⟺ resolve() 落在任一 allowed_root 内（relative_to 任一成功）
```

- `_resolve_safe_path` / `_bucket_of` / `_resolve_conversation_dir`（`resource_service.py`）改为按"员工工作空间根 + 公共区 + 房间"解析，而非单会话目录。
- **写**操作（删除/上传）仍限定到具体子桶（如 uploads、当前 conv），避免越权删别的会话产物（除非显式）。
- 跨员工：员工 B 的资源请求**只允许** B 自己的工作空间 + 公共区（+ B 所在房间）；**不能**直接读 A 的私有工作空间——A→B 必须经公共区。这是隔离边界。

---

## 5. prompt 指引（员工/总管文件工具一节增补）

在已去虚拟路径的文案上加三句：

- **交付物**：写到产物目录（cwd / `$ARTIFACTS_DIR`），与现在一致。
- **找自己过去的活**：在 `$WORKSPACE_DIR` 下按会话子目录（`conv-*`）翻；要复用旧产物先 `ls $WORKSPACE_DIR` 再 read。
- **跨员工共享/取用**：要把成果给别的员工 → 复制/写到 `$PUBLIC_DIR`；要用别人共享的 → 从 `$PUBLIC_DIR` 读。公共区是全员平摊，**起描述性文件名/子目录**避免互相覆盖。

---

## 6. 资源服务 / API / 工作台

### 6.1 资源列举（`ResourceService.list_resources`）

从"列举单会话"改为列举**员工工作空间 + 公共区**（房间上下文额外列房间）：

```
ResourceList {
  artifacts:    员工工作空间下【当前会话】子目录（默认聚焦视图）
  workspace:    员工工作空间全树（按 conv-* 分组；新字段，供"漫游全部"）
  public:       公共区（新字段）
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

## 7. 迁移

存量 `artifacts_path/<conversation_id>/artifacts/`（旧的会话级布局）：

- **方案（推荐）惰性兼容**：新会话用新布局；资源解析时，若员工工作空间下找不到该会话子目录，回退到旧 `artifacts_path/<conversation_id>/` 读取（只读兼容）。不做一次性搬迁，降低风险。
- 备选：启动时一次性把旧 `<conversation_id>/artifacts` 搬到对应 `employee-<id>/artifacts/conv-<id>/`——需会话→员工映射（DB 有），但有失败/中断风险，单机桌面不值当。
- **暂定惰性兼容**，§8 Q1 待定夺。

---

## 8. 开放问题（review 时定夺）

- **Q1 迁移策略**：惰性只读兼容旧布局（推荐）vs 启动一次性搬迁。**暂定惰性**。
- **Q2 公共区命名冲突**：全员平摊写，靠 prompt 约束命名 vs 加 `employee-<id>/` 二级前缀（公共区内按来源分子目录，避免覆盖但稍弱化"公共"感）。**暂定加来源子目录** `shared/from-<employee_id>/…` 兜底防覆盖，同时允许顶层公共文件。
- **Q3 总管工作空间**：总管是否需要独立工作空间，还是只读公共区 + 各员工产物汇总？**暂定给总管独立工作空间**（id=orchestrator），与员工一致。
- **Q4 房间与工作空间的关系**：房间产物结束后是否自动沉淀到参与者工作空间或公共区？**暂定不自动**（房间是临时区，要留存由 agent/用户显式复制到公共区）。
- **Q5 跨员工读权限**：是否允许员工**只读**别人的私有工作空间（不经公共区）？**暂定否**（私有=私有，共享必经公共区），保持清晰隔离边界。
- **Q6 工作台默认展示范围**：默认只显当前会话 vs 默认显整个工作空间。**暂定默认当前会话 + 可展开全工作空间/公共区**。

---

## 9. 受影响范围（实现时细化为分相位计划）

**服务端**：
- `agent/employee.py`、`agent/orchestrator/agent.py`：artifacts_dir 单值 → `$ARTIFACTS_DIR`/`$WORKSPACE_DIR`/`$PUBLIC_DIR` 三值解析；env 注入（`skill_shell_backend.py`）。
- `resource_service.py`：`_resolve_conversation_dir` → 员工工作空间根解析；沙箱放宽到三根并集；`list_resources` 增 workspace/public；upload 落点改会话子目录；迁移兼容回退。
- `api/chat_api.py`：资源端点沙箱/作用域随之调整。
- `schemas/resource.py`：`ResourceList` 增 `workspace`/`public` 字段，`bucket` 增值。
- prompt：`prompts.py`/`prompt_rules.py`/`orchestrator/prompts.py`/`AGENTS.md` 增 §5 三句。

**前端**：
- `pending-resources/paths.ts`：bucket 增 `workspace`/`public` 识别（段匹配）。
- `artifact-panel.tsx`：新增"工作空间全部"「公共区」折叠区。
- `merge.ts`、`conversation.ts`(api)：消费新 ResourceList 字段。

**测试**：目录解析三上下文、沙箱并集校验、跨员工隔离（B 读不到 A 私有、能读公共）、迁移回退、资源列举新字段。

**迁移/兼容**：旧会话级 artifacts 只读回退。
