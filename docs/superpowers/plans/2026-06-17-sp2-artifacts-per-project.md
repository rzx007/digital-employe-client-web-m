# 产物按项目目录（SP2）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. **分 4 阶段,每阶段全测过(后端基线 5 failed 不增、前端 typecheck 90 / vitest 1 failed)再进下一阶段。**

**Goal:** 把 AI 产物从一个全局大锅（`~/.digital-employee/conversations`，所有项目混在一起）改成**每个项目（工作空间）自己的目录**，产物对该项目所有会话扁平共享可见。

**Architecture:** 加纯函数 `resolve_workspace_product_root(root_path)`（托管区直放 / 外部文件夹套 `.digital-employee/`）+ DB 感知 `resolve_conversation_product_root(db, conv)`；把所有读写产物的站点从全局 `settings.artifacts_path` 穿透换成 per-project 产物根；目录布局扁平共享（`<root>/{artifacts,uploads,skills-draft}`，去掉 employee/conv/desk 分层）；新建工作空间自动建目录、删除清理+告警。**不迁移存量**（旧产物原地作废，双轨期老对话资源显空，接受）。

**Tech Stack:** Python FastAPI + SQLAlchemy（`uv`，requires-python ≥3.11）、pytest（注意 pytest-randomly，确定序用 `-p no:randomly`）。

**关联 spec:** [docs/superpowers/specs/2026-06-17-sp2-artifacts-per-project-design.md](../specs/2026-06-17-sp2-artifacts-per-project-design.md)

**基线:** 后端 `cd apps/server && uv run pytest -q -p no:randomly` → **5 failed / 632 passed**（5 个均迁移前基线失败：test_agent_runtime_policy×2 / test_orchestrator_execution_summary×1 / test_shell_error_steering×2，Windows 控制台编码/配置默认，与本迁移无关）。前端 `cd apps/web && npx tsc -p tsconfig.app.json --noEmit` → 90；`npx vitest run` → 1 failed。每阶段后确认零新增。

**⚠️ 每个 Task 后必跑全量后端套件确认零新增失败,再继续。提交时只 stage 自己的 hunk(`git add <显式路径>`,绝不 `git add -A`);仓库里长期有一处未提交的 `prompts.py`「判定从简」删除,不要碰、不要带进任何 commit。**

---

## 触点清单（实现期照此穷尽；来自探查 + 评审）

**产物读写站点（Phase 2 把全局 `settings.artifacts_path` 换 per-project 根）：**
- `api/chat_api.py` 资源端点 ~10 处（list/read/upload/download/static/delete/batch-delete，约 :432–:604）：`ResourceService.xxx(settings.artifacts_path, conv.id, ...)`。**含语音端点**（:519 voice/upload、:546 voice/audio，`save_voice_file`/`resolve_voice_path`，现写 legacy `<root>/<conv_id>/voice/`，一并换根）。
- `service/chat_service.py`：员工对话构建（:764 一带 `root_path = settings.artifacts_path`）、会话删除清理（:320–:342）、:481 `artifacts_root=get_settings().artifacts_path`。
- `service/agent/employee.py:136`（`resolve_workspace_dirs(root_path=root_path,...)`，root_path 上游来自 chat_service 传的 artifacts_path）。
- `service/agent/orchestrator/agent.py`（:154 `artifacts_path=Path(settings.artifacts_path)`、:196 desk、:200 workspace_dirs）。
- `service/agent/orchestrator/execution.py` / `rework.py`：desk 解析 + `orchestrator_task_subdir`。
- `service/resource_service.py`：内部按 `artifacts_root + conversation_id` 推会话根；SP2 后改为直接吃 per-project 产物根（buckets 直接在其下，conv_id 不再进路径）。

**目录生命周期（Phase 1）：** `workspace_service.py` 的 `create_workspace` / `create_user_workspace` / `ensure_user_default_workspace`（新建 mkdir 项目目录）、`delete_workspace`（删产物目录 + 告警）。

**desk 消解 + 契约（Phase 3）：** `workspace_paths.py` `resolve_orchestrator_desk_dir` / `orchestrator_task_subdir`；agent 文件系统提示词的 `$WORKSPACE_DIR`/`$PUBLIC_DIR`/`public_root` 语义。

---

## Phase 1 — 地基：产物根解析器 + 工作空间目录生命周期

> 目标：解析器与目录生命周期就位，行为可独立测；尚未穿透读写站点（那是 Phase 2）。

### Task 1.1: `resolve_workspace_product_root` 纯函数
**Files:**
- Modify: `apps/server/src/service/agent/workspace_paths.py`
- Test: `apps/server/tests/test_product_paths.py`（Create）

- [ ] **Step 1: 写失败测试**

```python
# tests/test_product_paths.py
from pathlib import Path
from src.service.agent.workspace_paths import (
    resolve_workspace_product_root,
    APP_PROJECTS_BASE,
)

def test_managed_root_returns_dir_directly():
    # 托管区项目目录：产物直接放其下，不套 .digital-employee
    managed = APP_PROJECTS_BASE / "5"
    assert resolve_workspace_product_root(str(managed)) == managed

def test_managed_base_itself_is_managed():
    assert resolve_workspace_product_root(str(APP_PROJECTS_BASE)) == APP_PROJECTS_BASE

def test_external_folder_gets_hidden_subdir():
    ext = Path("/tmp/my-source-repo")
    assert resolve_workspace_product_root(str(ext)) == ext / ".digital-employee"
```

- [ ] **Step 2:** 跑确认失败：`cd apps/server && uv run pytest tests/test_product_paths.py -q -p no:randomly`（ImportError）。

- [ ] **Step 3: 实现**（加到 `workspace_paths.py` 顶部 import 后）

```python
APP_PROJECTS_BASE = Path.home() / ".digital-employee" / "projects"

def resolve_workspace_product_root(root_path: str) -> Path:
    """项目产物根。
    - app 托管目录（~/.digital-employee/projects/<id>/）：整个目录归 app，产物直接放其下。
    - 外部用户文件夹（用户手选的源码目录）：套隐藏子目录 .digital-employee/ 防污染其文件树。
    """
    p = Path(root_path)
    if p.is_relative_to(APP_PROJECTS_BASE):  # is_relative_to 已含相等（Py≥3.11）
        return p
    return p / ".digital-employee"
```

- [ ] **Step 4:** 跑确认通过 + 全量后端（5 failed 不增）。
- [ ] **Step 5: Commit** `feat(sp2): resolve_workspace_product_root 产物根解析(托管区直放/外部套子目录)`

### Task 1.2: `resolve_conversation_product_root` DB 感知解析器
**Files:**
- Create: `apps/server/src/service/product_paths.py`
- Test: `apps/server/tests/test_product_paths.py`（追加）

- [ ] **Step 1: 写失败测试**

```python
def test_conversation_product_root_from_workspace(db_session):
    from src.models.workspace import Workspace
    from src.models.conversation import Conversation
    from src.service.product_paths import resolve_conversation_product_root
    from src.service.agent.workspace_paths import resolve_workspace_product_root
    ws = Workspace(name="w", root_path="/tmp/proj-x", user_id="u1")
    db_session.add(ws); db_session.flush()
    c = Conversation(workspace_id=ws.id, user_id="u1", target_type="curator", target_id=1)
    db_session.add(c); db_session.commit()
    got = resolve_conversation_product_root(db_session, c)
    assert got == resolve_workspace_product_root("/tmp/proj-x")
```

- [ ] **Step 2:** 跑确认失败。
- [ ] **Step 3: 实现**

```python
# src/service/product_paths.py
from __future__ import annotations
from pathlib import Path
from sqlalchemy.orm import Session
from src.models.conversation import Conversation
from src.models.workspace import Workspace
from src.service.agent.workspace_paths import resolve_workspace_product_root

def resolve_conversation_product_root(db: Session, conversation: Conversation) -> Path:
    """会话→其所钉项目→产物根。SP1 保证 conversation.workspace_id 必有。"""
    ws = db.get(Workspace, conversation.workspace_id)
    return resolve_workspace_product_root(ws.root_path)
```

- [ ] **Step 4:** 跑确认通过 + 全量。
- [ ] **Step 5: Commit** `feat(sp2): resolve_conversation_product_root(会话→项目产物根)`

### Task 1.3: 新建工作空间自动建项目目录
**Files:**
- Modify: `apps/server/src/service/workspace_service.py`（`create_user_workspace` + `_resolve_default_root` 或新 `_new_managed_project_dir`）
- Test: `apps/server/tests/test_workspace_product_dir.py`（Create）

- [ ] **Step 1: 写失败测试**——新建用户工作空间(不给 root_path)时,root_path 落在 `APP_PROJECTS_BASE` 下且目录已 mkdir。

```python
def test_create_user_workspace_auto_makes_managed_dir(db_session):
    from src.service.workspace_service import WorkspaceService
    from src.service.agent.workspace_paths import APP_PROJECTS_BASE
    from pathlib import Path
    ws = WorkspaceService.create_user_workspace(db_session, "u1", name="项目A", root_path=None)
    assert Path(ws.root_path).is_relative_to(APP_PROJECTS_BASE)
    assert Path(ws.root_path).is_dir()  # 已 mkdir
```

- [ ] **Step 2:** 跑确认失败（现回落盘符锚点、不 mkdir）。
- [ ] **Step 3: 实现**——`create_user_workspace`(及 `ensure_user_default_workspace` 的新建分支)在 `root_path is None` 时:先 flush 拿到 workspace.id,再 `root = APP_PROJECTS_BASE / str(ws.id); root.mkdir(parents=True, exist_ok=True); ws.root_path = str(root)`,commit。显式给的 root_path 原样存(外部文件夹,不 mkdir 其本体)。**注意**:需要先插入拿到 id,故顺序是 add→flush→算目录→赋值→commit。
- [ ] **Step 4:** 跑确认通过 + 全量。
- [ ] **Step 5: Commit** `feat(sp2): 新建工作空间自动建托管项目目录(projects/<id>)`

### Task 1.4: 删除工作空间清理产物目录 + 告警
**Files:**
- Modify: `apps/server/src/service/workspace_service.py`（`delete_workspace`）
- Test: `apps/server/tests/test_workspace_product_dir.py`（追加）

- [ ] **Step 1: 写失败测试**——两例:
  - 托管区 root_path → 删后整个目录不存在;
  - 外部 root_path(tmp 造一个含「用户文件」+ `.digital-employee/` 子目录) → 删后 `.digital-employee/` 没了、**用户文件还在**。

```python
def test_delete_managed_workspace_removes_whole_dir(db_session, tmp_path, monkeypatch):
    ...  # 造托管区 ws + 目录,delete_workspace 后断言目录不存在
def test_delete_external_workspace_removes_only_subdir(db_session, tmp_path):
    ext = tmp_path / "user-repo"; (ext).mkdir()
    (ext / "user_file.txt").write_text("keep me")
    (ext / ".digital-employee").mkdir()
    ...  # ws.root_path=ext;delete 后 .digital-employee 没了、user_file.txt 还在
```

- [ ] **Step 2:** 跑确认失败（现状不删任何目录）。
- [ ] **Step 3: 实现**——`delete_workspace` 删 DB 行(沿用 SP1 既有)之外,加磁盘清理:
  - `from src.service.agent.workspace_paths import resolve_workspace_product_root, APP_PROJECTS_BASE`;
  - 计算 `p = Path(workspace.root_path)`;
  - 若 `p.is_relative_to(APP_PROJECTS_BASE)` → `target = p`（整删）;否则 `target = resolve_workspace_product_root(workspace.root_path)`（= `p/.digital-employee`,只删子目录）;
  - `if target.exists(): logger.warning("delete_workspace: 删除产物目录 %s", target); shutil.rmtree(target, ignore_errors=True)`。**绝不删外部 p 本体**。
  - 容错:磁盘删除失败不应阻断 DB 删除(包 try/except + warning)。
- [ ] **Step 4:** 跑确认通过 + 全量。
- [ ] **Step 5: Commit** `feat(sp2): 删工作空间清理产物目录(托管整删/外部只删子目录)+告警`

---

## Phase 2 — 穿透：读写站点从全局根换 per-project 根

> 把触点清单的产物读写站点逐站改。**逐文件/区域一个 Task,每个 Task 后全量测。** 关键不变量:任何站点拿到 conversation/workspace 即可经 `resolve_conversation_product_root` / `resolve_workspace_product_root` 算出 per-project 根。

### Task 2.1: ResourceService 改吃 per-project 产物根（接口收敛）
**Files:**
- Modify: `apps/server/src/service/resource_service.py`、`apps/server/src/api/chat_api.py`（~10 资源端点）
- Test: `apps/server/tests/test_resource_service_product_root.py`（Create）

- **背景（评审要点）**:ResourceService 现按 `(artifacts_root, conversation_id)` 推会话根(`<artifacts_root>/<conv_id>` 或经 resolve_workspace_dirs),桶 `artifacts/uploads/skills-draft` 在其下。SP2 扁平共享后桶在**项目级**、conv 不进路径。
- **实现期先做**:读 ResourceService 每个公有方法签名,确定"conversation_dir 怎么算出来的"。把它改成**直接吃 `product_root`(项目产物根,桶直接在其下)**,`conversation_id` 仅 API 层用于"conv→project 解析",不再进路径。
- [ ] 写测试:`list_resources(product_root)` 列出 `<product_root>/{artifacts,uploads,skills-draft}` 桶内文件,与 conv 无关(同项目两 conv 看到同一批)。
- [ ] 改 ResourceService 公有方法签名:`artifacts_root`→`product_root`,去掉路径里的 conv 段(沙箱根 = product_root)。
- [ ] 改 chat_api ~10 端点(**含语音 :519/:546**):每处先 `conv = ChatService.get_conversation(db, conversation_id); root = resolve_conversation_product_root(db, conv)`,再 `ResourceService.xxx(root, ...)`。**逐个端点改 + 本地验证。**
- [ ] **删死代码(评审)**:ResourceService 里现有的 legacy 双轨读回退分支(`legacy = Path(root_path)/str(conversation_id)` 之类)与 `_read_roots_with_desk` 迁移兼容路径,签名改 product_root 后会算出陈旧/错误路径——一并**删除**(spec §2 明确"不做双轨读回退",§4(d) 默认不回退 legacy)。
- [ ] 全量测;Commit `feat(sp2): ResourceService 吃项目产物根 + chat_api(含语音)穿透 + 删 legacy 双轨读`。

### Task 2.2: 员工对话 agent 构建穿透
**Files:** `apps/server/src/service/chat_service.py`（:764 一带、:481）、`apps/server/src/service/agent/employee.py:136`。
- [ ] 把员工对话构建里 `root_path = settings.artifacts_path` 改为 `resolve_conversation_product_root(db, conversation)`(该处有 conversation/workspace 上下文;若只有 conversation_id 则先 get_conversation)。`resolve_workspace_dirs` 内部子结构本 Task 暂不动(Phase 3 拍平),只换根。
- [ ] employee.py:136 的 root_path 入参随上游改变,确认透传正确。
- [ ] 写/改测试覆盖"员工对话产物落到该项目根下"。全量测;Commit `feat(sp2): 员工对话产物落项目根`。

### Task 2.3: 总管 agent 构建 + desk 解析穿透
**Files:** `apps/server/src/service/agent/orchestrator/agent.py`（:154/:196/:200）、`execution.py`、`rework.py`。
- [ ] orchestrator agent 的 `artifacts_path` 换成该会话项目产物根(agent 构建处有 workspace_id/conversation;经 resolve_*_product_root)。
- [ ] desk 解析(`resolve_orchestrator_desk_dir`)的 root_path 也换 per-project 根。**本 Task 只换根、不拆 desk 结构**(拆在 Phase 3),保证穿透与结构改动分离、好定位回归。
- [ ] **旁路确认(评审 blocker)**:定时任务(`task_scheduler_service`)/编排再入(`reentry.py`)起总管流的路径,也要能解析到项目根——它们手里有 conv/workspace_id。逐个确认不漏。
- [ ] 写/改测试;全量测;Commit `feat(sp2): 总管/desk/旁路 产物落项目根`。

### Task 2.4: 会话删除清理路径穿透
**Files:** `apps/server/src/service/chat_service.py`（:320–:342 `adelete_conversation`）。
- [ ] 会话删除时清理产物的路径从全局 artifacts_path 改为该会话项目产物根;扁平共享下「删一个会话的产物」语义要重定义(产物是项目共享的,删会话**不应**删共享产物)——**实现期定**:倾向删会话只删 DB/checkpoint,**不删**共享 `artifacts/`(否则误删别的会话还在用的产物);仅清理该会话私有的(若 Phase 3 后 uploads/skills-draft 仍项目级共享,则同样不按会话删)。在测试与注释里写明这个语义决定。
- [ ] 全量测;Commit `fix(sp2): 会话删除不误删项目共享产物`。

---

## Phase 3 — 拆共享桌 + 文件系统契约

### Task 3.1: 目录布局拍平（去 employee-<id> / conv-<id>）
**Files:** `apps/server/src/service/agent/workspace_paths.py`（`resolve_workspace_dirs`）、其调用方。
- [ ] 把 `resolve_workspace_dirs` 的子结构从 `employee-<id>/artifacts/conv-<cid>` + `shared/...` 拍平为 `<product_root>/{artifacts,uploads,skills-draft}`。**三个桶都去 conv 段**(评审提示:现 uploads/draft 都从 conv_artifacts 派生,要一并改)。
- [ ] `public_dir`/`public_root` 语义收敛(见 3.2)。
- [ ] 写测试断言三桶直接在 product_root 下、无 employee/conv 段;全量测;Commit `feat(sp2): 产物目录拍平为项目级三桶`。

### Task 3.2: $WORKSPACE_DIR / $PUBLIC_DIR 契约收敛 + 共享桌消解
**Files:** `workspace_paths.py`（`resolve_orchestrator_desk_dir`/`orchestrator_task_subdir`）、agent 文件系统提示词构建处、`execution.py`/`rework.py`。
- [ ] **决定并实现**:扁平共享后全队天然写同一项目 `artifacts/`,`orchestrator-desk` 顶层树消解——`resolve_orchestrator_desk_dir` 退化为指向项目 `artifacts/`(或调用点直接用项目 artifacts,函数删除)。`shared_artifacts_dir` 注入管道按需简化。
- [ ] **细节 (a)**:并发子任务撞名兜底——若需要,给派活保留 `artifacts/.task-<id>/` 可选薄子目录;否则靠文件名。实现期定并注释。
- [ ] **细节 (b)**:`$WORKSPACE_DIR`/`$PUBLIC_DIR`/`public_root` 语义——per-project 下收成项目级单一共享区(`$WORKSPACE_DIR`=`$PUBLIC_DIR`=项目 artifacts)或保留双层。配 agent 文件系统**契约测试**(员工能读写产物、能读到队友产物)。
- [ ] 全量测 + 协作回归;Commit `feat(sp2): 消解 orchestrator-desk 为项目级共享 + 收敛文件系统契约`。

### Task 3.3: 员工级产物目录删除按全项目扫
**Files:** `apps/server/src/service/employee_service.py:960` 一带。
- [ ] 删员工时清理其产物目录——员工跨项目(SP1),**倾向扫所有项目**(遍历该 user 的所有 workspace 产物根,删该员工痕迹)以免留孤儿。实现期按拍平后的新布局定位(扁平共享后已无 `employee-<id>` 目录,可能此清理大幅简化甚至不再需要——实现期核实后处理)。
- [ ] 全量测;Commit `fix(sp2): 员工产物清理适配项目级布局`。

---

## Phase 4 — 端到端自检 + 集成评审

### Task 4.1: 端到端自检 + 最终集成评审
- [ ] 后端全量 5 failed/基线;前端 typecheck 90 / vitest 1 failed。
- [ ] **人工冒烟**:① 新建项目→产物落 `projects/<id>/artifacts/`(或外部文件夹的 `.digital-employee/artifacts/`);② 同项目两会话互见产物(扁平共享生效);③ 不同项目产物隔离;④ 删项目→产物目录被清(托管整删/外部只删子目录)+ 日志告警;⑤ 总管派活,队友产物总管读得到(协作仍通);⑥ 老对话资源显空(双轨,符合预期)。
- [ ] **整盘 SP2 集成评审**(`git diff <Phase1 起点>..HEAD`,用 code-reviewer subagent):完整性(还有没有漏掉的 `settings.artifacts_path` 产物站点)、删除安全(外部根绝不误删用户文件)、文件系统契约回归、旁路覆盖。
- [ ] 修评审发现;finishing-a-development-branch。

---

## 风险与注意
- **穿透面广**:~10+ 站点;每 Task 后全量回归(仿 SP1)。换根(Phase 2)与拆结构(Phase 3)**刻意分离**,便于定位回归。
- **删除安全**:外部用户文件夹**只**删 `.digital-employee/` 子目录,务必单测覆盖"用户文件还在"。
- **会话删除语义**:扁平共享后产物是项目级共享,删会话不应删共享产物(Task 2.4)。
- **文件系统契约**:动 `$WORKSPACE_DIR`/`$PUBLIC_DIR` 可能影响员工读写产物,需契约级测试(Task 3.2)。
- **双轨期**:老对话产物在 legacy 全局、新的在 per-project,UI 老对话资源显空——已知并接受。
- **基线门**:任一 Task 后全量后端必须仍 5 failed(零新增),前端 typecheck 90 / vitest 1 failed。
