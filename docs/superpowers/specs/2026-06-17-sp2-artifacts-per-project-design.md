# 产物按项目目录（SP2）设计

> 工作空间模型重构的第 2 个子项目。SP1（多工作空间 + 团队/对话用户级）已落地；SP2 解决"产物落盘"层：把产物从一个全局大锅，改成**每个项目（工作空间）自己的目录**，使一个项目的产物对该项目所有会话可见、且项目目录自包含。

## 1. 现状（探查确认）

产物落盘与"工作空间"几乎脱节，存在**两个互不相干的根**：

- **`settings.artifacts_path`** = `~/.digital-employee/conversations`（`config.py:13` `get_default_artifacts_path()`，硬编码、无 override）。**全局单例**。所有工作空间的全部产物（员工产物 / 上传 / 公共区 / 总管桌）都堆在这一棵树下，**仅靠 `employee-<id>` / `conv-<会话id>` 路径段分隔，路径里压根没有 `workspace_id`**。
- **`workspace.root_path`**（`models/workspace.py:23`）= 用户的"项目文件目录"，文件浏览器 `FileService` 指向它（`workspace_api.py:144`）。但 **AI 产物根本不写这里**；且新建工作空间时 `root_path` 都回落到同一个默认根（`_resolve_default_root` → 配置 `DEFAULT_WORKSPACE_ROOT` 或盘符锚点如 `C:/`，`workspace_service.py`），多个项目共用同一物理目录。

所有 `resolve_workspace_dirs(root_path=...)` 调用点传的都是全局 `settings.artifacts_path`（`chat_service.py:329/764`、`agent/employee.py:136`、`agent/orchestrator/agent.py:200`、`resource_service.py:164`）；`resolve_orchestrator_desk_dir` 同理。`delete_workspace`（`workspace_service.py`）**不删任何磁盘目录**，仅删 DB 行。

**底线**：今天产物完全混在一个全局树里、无项目隔离；删工作空间不动磁盘。SP1 让"一个用户多个项目"成立后，这是必须补的下一块。

## 2. 目标与范围

**目标**：产物从全局大锅 → **每个项目自己的目录**；一个项目的产物对该项目**所有会话共享可见**（这是"工作空间"的本意）；项目目录文件层面自包含（可整体拷走/备份/git，作为免费副产品，不作为承诺）。

**做**：
- 产物根解析器：从全局 `artifacts_path` 换成"该会话所钉项目的产物根"，穿透所有读写站点。
- 工作空间目录生命周期：新建自动建独立项目目录；删除清理产物目录 + 告警。
- 目录布局**扁平共享**：项目产物根下直接 `artifacts/ uploads/ skills-draft/`，全项目所有会话共享，去掉 `employee-<id>` / `orchestrator-desk` 分层。

**不做（明确推迟/砍掉）**：
- **不迁移存量**：旧全局产物原地不动（快速开发期，DB 可重置）。接受"老对话产物作废"的双轨期。
- **不做可移植机制**：无 manifest / 导出导入 / 每项目自带库（B/C 档）。自包含是布局的免费副产品，不加任何额外机制。
- 真 auth / 权限强隔离（SP3 范畴）不在内。

## 3. 设计

### 3.1 产物根解析（核心）

新增纯函数（`agent/workspace_paths.py`）：
```python
APP_PROJECTS_BASE = Path.home() / ".digital-employee" / "projects"

def resolve_workspace_product_root(root_path: str) -> Path:
    """项目产物根。
    - app 托管目录（projects/<id>/）：整个目录归 app，产物直接放其下。
    - 外部用户文件夹（用户手选的源码目录）：套隐藏子目录 .digital-employee/ 防污染。
    """
    p = Path(root_path)
    if p.is_relative_to(APP_PROJECTS_BASE):   # is_relative_to 已含相等情形（Py≥3.9，本项目 ≥3.11）
        return p
    return p / ".digital-employee"
```

DB 感知解析器（service 层，新 `product_paths.py` 或并入 `workspace_service`）：
```python
def resolve_conversation_product_root(db, conversation) -> Path:
    ws = db.get(Workspace, conversation.workspace_id)   # SP1 保证 conv 必带 workspace_id
    return resolve_workspace_product_root(ws.root_path)
```

`resolve_workspace_dirs` / `resolve_orchestrator_desk_dir` 的 `root_path` 入参，从全局 `artifacts_path` 改为上面算出的 per-project 产物根。

### 3.2 目录布局（扁平共享）

```
<product_root>/artifacts/       ← AI 产物（$ARTIFACTS_DIR），全项目所有会话共享读写
<product_root>/uploads/         ← 上传文件
<product_root>/skills-draft/    ← 技能草稿
```

- **去掉 `employee-<id>` 层**：它本是全局大锅里区分员工的，产物按项目隔离后无意义。
- **去掉 `conv-<会话id>` 隔离层**：刻意不加——工作空间的本意就是产物对该项目所有会话可见；用目录硬隔离会重新切碎共享。**注意**：`artifacts/`、`uploads/`、`skills-draft/` **三个**桶都拍平到项目级、都去掉 conv 段。现 `resolve_workspace_dirs` 是把三者都从 `conv_artifacts`（含 conv 段）派生的，实现期须有意识地一并改这三个桶的形状（不只是 `artifacts/`）。
- **撞名按共享文件夹常识处理**：同名后写覆盖（last-write-wins），靠 AI / 总管起有意义文件名规避，不用层级硬隔离。

### 3.3 总管派活的"共享桌"消解

现状：总管派出多个员工各跑自己对话，产物写进总管会话的共享桌（`orchestrator-desk/conv-<总管会话id>/`），靠 `shared_artifacts_dir` 注入让全队互读。

SP2 下扁平共享后，**全队天然写同一个项目 `artifacts/`，协作零成本**——`orchestrator-desk` 顶层树与大部分 `shared_artifacts_dir` 注入管道可拆除。`resolve_orchestrator_desk_dir` 退化为指向项目产物根（或直接消失，调用点改用项目 `artifacts/`）。

### 3.4 工作空间目录生命周期

- **新建**（`create_workspace` / `ensure_user_default_workspace` / `POST /workspaces`）：未显式给 `root_path` 时，自动 `~/.digital-employee/projects/<workspace_id>/` 并 `mkdir(parents=True, exist_ok=True)`。显式 `root_path`（用户选的外部文件夹）原样存——**前端目录选择器先留占位**，后端契约就位。
- **删除**（`delete_workspace`，方案 B + 告警）：
  - `root_path` 在托管区（`projects/<id>/`）→ 删**整个** `root_path` 目录；
  - `root_path` 是外部文件夹 → **只删** `<root_path>/.digital-employee/` 子目录，**绝不**碰用户其他文件；
  - 两种都 `logger.warning` 记删了哪条路径。DB 行删除沿用 SP1 既有逻辑。

## 4. 触点清单（穿透，实现期照此穷尽）

把所有"用全局 `settings.artifacts_path` + conv"的站点，改成"该会话项目产物根"：
- **`api/chat_api.py`** 资源端点 ~10 处（list/read/upload/download/static/delete/batch-delete resources，约 :432–:604）：现 `ResourceService.xxx(settings.artifacts_path, conv.id)` → 先 `resolve_conversation_product_root(db, conv)` 再传。
- **`service/chat_service.py`**：员工对话构建（:764 一带）、会话删除清理（:320–:342）、:481 artifacts_root。
- **`service/agent/employee.py`**（:136 resolve_workspace_dirs）、**`agent/orchestrator/agent.py`**（:196 desk、:200 workspace_dirs）、**`agent/orchestrator/execution.py` / `rework.py`** 的 desk 解析。
- **`service/resource_service.py`** 内部 root_path 透传。

## 5. 留给 plan 细化的细节（不在 spec 强定）

- **(a) 派活并发撞名**：扁平共享下，一次总管 turn 里多个并发子任务若写同名文件可能互撞。是否给"派活"保留一个可选薄子目录（如 `artifacts/.task-<id>/`）兜底，plan 定。
- **(b) `$WORKSPACE_DIR` / `$PUBLIC_DIR` / `public_root` 契约**：现 agent 文件系统提示词暴露"自己工作区 / 公共区"双层语义。per-project 扁平后，公共区收成项目级单一共享区还是直接并入 `artifacts/`——涉及 agent 提示词契约，plan 细化并配测试。
- **(c) 员工级产物目录**：`employee_service.py:960` 按 `artifacts_path/employee-<id>` 删员工产物——员工现跨项目（SP1），其产物可能散在多个项目，**倾向"扫所有项目"删**以免留孤儿产物；plan 定。
- **(d) 不迁移的双轨读**：默认 per-project 路径不存在时**不**回退 legacy 全局（老对话产物作废）。是否加一行 legacy 读回退保住老对话产物可见，plan 定（倾向不做）。

## 6. 风险与注意

- **穿透面广**：~10+ 站点把全局根换 per-project，是 SP2 本体工作量；逐站改 + 回归（仿 SP1 的 user_id 穿透纪律）。
- **无请求上下文的旁路**（定时任务 / 编排再入）：手里有 conv/workspace_id，可经 `resolve_conversation_product_root` 解析，但要逐个确认不漏。
- **删除安全**：外部用户文件夹**只**删 `.digital-employee/` 子目录，绝不删用户文件；删前告警。务必单测覆盖"外部根只删子目录"。
- **agent 文件系统契约回归**：动 `$WORKSPACE_DIR`/`$PUBLIC_DIR` 可能影响员工读写产物的能力，需契约级测试。
- **双轨期**：老对话产物在 legacy 全局、新的在 per-project，UI 里老对话资源会显空——已知并接受（快速开发 + DB 可重置）。

## 7. 分阶段（每阶段全测过再进；后端基线 5 failed、前端 typecheck 90 / vitest 1 failed）

- **Phase 1 地基**：`resolve_workspace_product_root`（含托管区前缀判断）+ `resolve_conversation_product_root` + 工作空间目录生命周期（新建自动 mkdir、删除 B+告警）。TDD：解析器分情况、删除只删子目录。
- **Phase 2 穿透**：把 §4 触点逐站从全局根换 per-project 根；每站后全量回归。
- **Phase 3 拆共享桌 + 契约**：`orchestrator-desk` → 项目级扁平共享 `artifacts/`；理清 `$WORKSPACE_DIR`/`$PUBLIC_DIR` 契约（细节 (a)(b)）。配协作 + 文件系统契约回归。
- **Phase 4 自检 + 集成评审**：端到端冒烟（建项目→产物落对地方→项目间隔离→删项目清目录+告警→总管派活协作仍通→老对话双轨显空符合预期）+ 整盘 SP2 集成评审。
