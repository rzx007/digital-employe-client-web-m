# 工作空间根 + 外部文件夹 + 产物按轮隔离 — 设计 spec

- 日期：2026-06-23
- 分支：feat/orchestrator-centric
- 关联：SP2 产物按项目（[2026-06-17-sp2-artifacts-per-project-design.md](2026-06-17-sp2-artifacts-per-project-design.md)）、调度收敛（[2026-06-22-scheduling-consolidation-design.md](2026-06-22-scheduling-consolidation-design.md)）

## 1. 背景与三件事

用户发现默认工作空间的产物落在 `D:\.boban-staff\artifacts`（盘根扁平），而非期望的 `~/.boban-staff/projects/<id>`。审计后定三件相关事：

1. **默认工作空间根改为 app 托管 `projects/<id>`**（不再用盘根回退）。
2. **放开"外部文件夹"作为工作空间**：自动授权（不审批）、**直接以该文件夹为产物根**（不套 `.boban-staff` 前缀、不分 artifacts/uploads 子目录、平铺）、**支持非空目录**（如已有代码仓）。前端补文件夹选择器。
3. **修 Bug 3**：定时轮的交付物**只归本轮 per-run 会话**显示，不再污染创建源/主对话。

## 2. 现状盘点（已读码取证）

- `WorkspaceService._resolve_default_root()`（[workspace_service.py:37](../../../apps/server/src/service/workspace_service.py)）：`DEFAULT_WORKSPACE_ROOT` 未配 → 回退到**代码安装盘的盘根** `Path(__file__).anchor`（代码在 D: → `D:\`）。`ensure_default_workspace`（:127）用它给 ws#1 设 root。
- `resolve_workspace_product_root(root_path)`（[workspace_paths.py:38](../../../apps/server/src/service/agent/workspace_paths.py)）：root 在 `APP_PROJECTS_BASE`（=`~/.boban-staff/projects`）下 → 直接用；否则当**外部文件夹** → 套 `<root>/.boban-staff/`。
- `resolve_workspace_dirs`（:49）：artifacts/workspace/public_dir/public_root 全 = `root/artifacts`；uploads=`root/uploads`；draft=`root/skills-draft`。
- `create_user_workspace`（:179）/`create_workspace`（:146）：传了 root_path 直接存，**无外部路径校验/拒绝**；新建无 root 时用 `APP_PROJECTS_BASE/<id>`。前端新建工作空间对话框（[workspace-switcher.tsx](../../../apps/web/src/components/.../workspace-switcher.tsx)）**只有名字输入框，无文件夹选择器**。
- 外部目录授权：`authorized_dir_service.grant_dir/list/revoke`（[authorized_dir_service.py](../../../apps/server/src/service/authorized_dir_service.py)）+ `WorkspaceAuthorizedDir` 模型，现状**创建工作空间时不调用**。
- `collect_plan_deliverables(db, plan_id)`（[orchestration_lifecycle.py:58](../../../apps/server/src/service/orchestration_lifecycle.py)）：按 plan 聚合（每子任务**最新**日志→其会话 write/edit_file tool parts），**无 run 维度**。API `GET /orchestration/plans/{plan_id}`（[orchestration_api.py:175](../../../apps/server/src/api/orchestration_api.py)）返回 `artifacts`。前端 `CuratorTurnDeliverables`（[curator-turn-deliverables.tsx](../../../apps/web/src/components/.../curator-turn-deliverables.tsx)）按 conversation_id 找 plan → 拉 plan detail → 渲染交付物卡。
- per-run 会话 `session_flags = {"kind":"scheduled_run","plan_id","run_seq"}`（无 run_id）。

## 3. 目标 / 非目标

### 目标
- A：默认工作空间根 = `APP_PROJECTS_BASE/<default_id>`；存量 ws#1 启动时迁移 root_path（**不搬旧产物**，用户定）。
- B：外部文件夹工作空间——自动授权、**flat 直挂**（root 即产物根，无 `.boban-staff`、无 artifacts/uploads 子目录）、支持非空；前端 Electron 原生文件夹选择器。
- C：交付物按 run 隔离——per-run 会话只显示本轮、主对话只显示自己那次（manual）run、纯定时计划主对话无交付物。

### 非目标
- 不搬迁旧产物（D:\.boban-staff 留着，孤儿，开发阶段无所谓）。
- 不改 app 托管（projects/<id>）的产物结构（仍 artifacts 子目录；只有外部文件夹走 flat）。
- 不做外部目录授权审批 UI（自动授权）。
- 不动调度/DAG/per-run 会话创建本身（C 只加 run_id 到 session_flags + 隔离查询/渲染）。

## 4. 组件A：默认工作空间根 → projects/<id>

- `ensure_default_workspace`（[workspace_service.py:127](../../../apps/server/src/service/workspace_service.py)）：把 `default_root = _resolve_default_root()` 改为 `APP_PROJECTS_BASE / str(default_workspace_id)`，并 `mkdir(parents=True, exist_ok=True)`（与 `ensure_user_default_workspace` 的托管目录建法一致）。
- `create_workspace`（:146）无 root 回退同改为 `APP_PROJECTS_BASE/<id>`（或复用统一 helper）。`_resolve_default_root` 若仅这两处用，删除；否则保留 `DEFAULT_WORKSPACE_ROOT` 显式配置优先、回退改为 app 托管而非盘根。
- **存量迁移**（init_db 启动幂等）：`_migrate_default_workspace_root` —— 若默认 workspace（id=default_workspace_id）的 `root_path` 不在 `APP_PROJECTS_BASE` 下且不是用户显式选的外部（判定：等于盘根 anchor，如 `D:\` / `C:\`）→ 改为 `APP_PROJECTS_BASE/<id>` 并 mkdir。只动"盘根回退"产生的脏值，不动用户显式外部根。日志列出。
  - **判定谓词**：`root_path` 去尾斜杠后 == `Path(root_path).anchor`（即就是个盘根）→ 视为回退脏值，迁移。

## 5. 组件B：外部文件夹工作空间（flat / 非空 / 自动授权）

### 5.1 路径模型改造
区分两类 workspace root：
- **app 托管**（root 在 `APP_PROJECTS_BASE` 下）：保持现状——产物根=root，artifacts=`root/artifacts`，uploads=`root/uploads`，draft=`root/skills-draft`。
- **外部文件夹**（root 不在 APP_PROJECTS_BASE 下）：**flat 直挂**——
  - `resolve_workspace_product_root(external)` 返回 `external` **本身**（不再套 `.boban-staff`）。
  - `resolve_workspace_dirs` 对外部 root：`artifacts_dir = workspace_dir = public_dir = public_root = root`（即文件夹本身，产物平铺其中）；`uploads_dir = root`（平铺，用户明确要求）。
  - `draft_dir`（skills-draft，员工技能草稿，与项目交付无关、属内部 plumbing）：**不平铺进外部文件夹**——路由到 app 托管的 per-workspace 隐藏位置（如 `APP_PROJECTS_BASE/_external_drafts/ws-<id>/skills-draft`），避免污染用户代码仓。（这是对"直接平铺"的唯一例外，理由=技能草稿非交付物；实现时如评审认为应一并平铺，再调。）
  - 需把 `resolve_workspace_dirs` 改成**接收"是否外部 + workspace_id"**或直接接收已解析的 product_root + is_external 标志，按分支给目录。READ 现签名（接收 root_path + base_dir）后选最小改动法。
- **关键副作用核查**：`resource_service`/产物面板扫描 artifacts_dir。外部 flat 时 artifacts_dir=root=用户文件夹 → 面板会列出文件夹**全部文件**（含用户已有文件）。这对"外部=我的项目文件夹、IDE 式工作"是**预期**（文件树即项目）。但**交付物卡**（`collect_plan_deliverables`）走 tool parts（agent 写过的文件），**不**是目录扫描，故非空目录里只显示 agent 产出——无污染。实现时确认两条链路区分清楚。

### 5.2 创建 + 自动授权
- `create_user_workspace`（:179）：传入外部 root_path 时——
  - 校验 `Path(root_path).exists()`（不存在 → 400），**允许非空**（不校验空）。
  - **自动授权**：创建后调 `authorized_dir_service.grant_dir(db, workspace.id, root_path)`（用户亲手选=已信任），免审批卡。
  - 设 `auto_grant_external_dirs=True`（[workspace.py](../../../apps/server/src/models/workspace.py) 已有列）使 agent 运行期写该目录不再弹审批。
- 后端不拒绝外部路径（现状即不拒）；只补 exists 校验 + 自动 grant。

### 5.3 前端文件夹选择器
- 新建工作空间对话框（[workspace-switcher.tsx](../../../apps/web/src/components/.../workspace-switcher.tsx)）加一个"选择文件夹"按钮 → Electron 原生目录对话框（`dialog.showOpenDialog({properties:['openDirectory']})`，经现有 IPC 桥；grep preload/ipc 找现成目录选择通道，若无则新增一个 `select-directory` IPC）。
- 选中路径回填，传给 `createWorkspace(name, rootPath)`（[api/workspace.ts](../../../apps/web/src/api/workspace.ts) 已支持 rootPath 参数）。不选=app 托管默认（现状）。
- 文案提示："选择一个本地文件夹作为工作空间（产物直接存入该文件夹；支持已有项目目录）"。

## 6. 组件C：交付物按 run 隔离（Bug 3）

### 6.1 session_flags 补 run_id
`create_scheduled_run_conversation`（[plan_run_service.py](../../../apps/server/src/service/agent/orchestrator/plan_run_service.py)）的 `session_flags` 加 `run_id`：`{"kind":"scheduled_run","plan_id":...,"run_seq":...,"run_id":run.id}`。

### 6.2 后端按 run 过滤
- `collect_plan_deliverables(db, plan_id, run_id=None)`：run_id 非空时，子任务日志查询加 `TaskExecutionLog.run_id == run_id`（取该轮日志，而非全历史最新）。
- API：`GET /orchestration/plans/{plan_id}` 加可选 query `?run_id=N`（或 `?conversation_id=C` 由后端解析 run）。**推荐 conversation_id 维度**——前端总有当前 conversation_id：后端按 conversation 解析它代表的 run：
  - 该 conversation 是某 PlanRun.conversation_id（per-run 或 manual）→ 用那个 run_id 过滤。
  - 否则（非 run 会话）→ 返回空 artifacts。
  - 新 helper `resolve_run_id_for_conversation(db, plan_id, conversation_id) -> int | None`。

### 6.3 前端按当前会话取本轮交付物
- `CuratorTurnDeliverables`（[curator-turn-deliverables.tsx](../../../apps/web/src/components/.../curator-turn-deliverables.tsx)）：
  - per-run 会话（`session_flags.kind=="scheduled_run"`）：读 plan_id（从 session_flags），调 `fetchOrchestrationPlanDetail(plan_id, {conversation_id: 当前会话})` → 渲染本轮交付物卡。当前它按 conversation_id 找 plan（plan.conversation_id），per-run 会话找不到 plan → 需改为从 session_flags 取 plan_id。
  - 主对话（plan 创建源）：传当前 conversation_id → 后端解析为"创建源对应的 manual run"（若有）→ 只显示那次交付物；纯定时计划无 manual run → 空（不显示定时轮产物）。
- 前端 `fetchOrchestrationPlanDetail` 加可选 `conversation_id` 透传到 API query。

## 7. 改动面清单

| 组件 | 文件 | 改动 |
|---|---|---|
| A | `service/workspace_service.py` | ensure_default_workspace/create_workspace 用 APP_PROJECTS_BASE/<id> |
| A | `db/init_db.py` | `_migrate_default_workspace_root` 迁移盘根脏值 |
| B | `service/agent/workspace_paths.py` | 外部 root flat（product_root=root,artifacts/uploads 平铺,draft 例外） |
| B | `service/workspace_service.py` | create_user_workspace 外部 exists 校验 + 自动 grant + auto_grant_external_dirs |
| B | 前端 `workspace-switcher.tsx` + ipc/preload | 文件夹选择器 + 传 rootPath |
| C | `service/agent/orchestrator/plan_run_service.py` | session_flags 加 run_id |
| C | `service/orchestration_lifecycle.py` | collect_plan_deliverables 加 run_id 过滤 + resolve_run_id_for_conversation |
| C | `api/orchestration_api.py` | get_plan 加 conversation_id query → run 解析 |
| C | 前端 `curator-turn-deliverables.tsx` + `api/orchestration.ts` | per-run 会话按 session_flags.plan_id + 当前会话取本轮交付物 |

测试：
- A：ensure_default_workspace 返回 projects/<id> root；迁移把盘根脏值改 projects/<id>、不动 app 托管/用户外部根。
- B：resolve_workspace_product_root(外部) = 外部本身（无 .boban-staff）；resolve_workspace_dirs 外部 flat（artifacts=root）；create_user_workspace 外部 → 自动 grant + auto_grant_external_dirs=True + 非空允许 + 不存在报 400。
- C：collect_plan_deliverables(plan,run_id) 只返该轮文件；resolve_run_id_for_conversation 解析 per-run/manual/非run；API conversation_id 维度返本轮；纯定时计划主对话(创建源)无 manual run → 空。
- 全后端零新增回归；前端 typecheck 零新增。

## 8. 风险
- 外部 flat + 非空目录：产物面板（dir 扫描）会列用户文件——是 IDE 式预期；交付物卡走 tool parts 无污染。需实现时确认两链路。
- skills-draft 平铺例外：若评审/用户坚持完全平铺，再调（默认隔离到 app 托管防污染代码仓）。
- 默认根迁移只动"盘根脏值"——谓词须精确（== anchor），避免误迁用户显式外部根或已迁的 projects 根。
- Electron 目录对话框 IPC：需确认现有 preload 暴露通道，无则新增（前端实跑验证）。

## 9. 验收对照
- 新建普通工作空间 → root=`~/.boban-staff/projects/<id>`，产物进 `projects/<id>/artifacts`；ws#1 重启后 root 迁到 `projects/1`。
- 新建工作空间时可选一个本地文件夹（含非空代码仓）→ 自动授权、产物**直接平铺**进该文件夹、无 `.boban-staff` 子目录。
- 定时轮「世界杯提醒」的交付物只在**本轮 per-run 会话**显示；主对话不再出现定时轮产物。
