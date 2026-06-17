"""员工工作空间目录解析（纯函数）。

产物升到员工级：workspace = root/employee-<owner>/artifacts，当前会话在其 conv-<cid> 子目录；
公共区按来源分层 root/shared/employee-<owner>/conv-<cid>，读面向整个 root/shared。
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class WorkspaceDirs:
    artifacts_dir: Path   # $ARTIFACTS_DIR 写当前会话产物（房间上下文=房间共享）
    workspace_dir: Path   # $WORKSPACE_DIR 员工工作空间根（读自己全部）
    uploads_dir: Path     # $UPLOADS_DIR
    draft_dir: Path       # 技能草稿目录（员工私有，恒用 conv_artifacts 算定，不随共享桌漂移）
    public_dir: Path      # $PUBLIC_DIR 写自己公共子区
    public_root: Path     # $PUBLIC_ROOT 读全部公共


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


def _owner_token(employee_id: int | str | None) -> str:
    if employee_id is None or str(employee_id) == "":
        return "employee-default"
    return f"employee-{employee_id}"


def resolve_workspace_dirs(
    *,
    root_path: str | None,
    employee_id: int | str | None,
    conversation_id: int | None,
    shared_artifacts_dir: str | None,
    shared_workspace_root: Path | None = None,   # 新增：共享桌只读根
    base_dir: Path,
) -> WorkspaceDirs:
    """解析员工工作空间 + 公共区的五个目录（不创建目录，纯计算）。"""
    root = Path(root_path) if root_path else Path(base_dir)
    owner = _owner_token(employee_id)
    conv_seg = f"conv-{conversation_id}" if conversation_id else "_scratch"

    public_root = root / "shared"
    public_dir = public_root / owner / conv_seg
    workspace_dir = root / owner / "artifacts"
    conv_artifacts = workspace_dir / conv_seg          # uploads/会话私有，恒按员工算（先于重定向定下）
    if shared_workspace_root is not None:
        workspace_dir = Path(shared_workspace_root)    # 只改读根为共享桌，不动 conv_artifacts

    if shared_artifacts_dir:
        artifacts_dir = Path(shared_artifacts_dir)
    else:
        artifacts_dir = conv_artifacts
    uploads_dir = conv_artifacts / "uploads"
    draft_dir = conv_artifacts / "skills-draft"

    return WorkspaceDirs(
        artifacts_dir=artifacts_dir,
        workspace_dir=workspace_dir,
        uploads_dir=uploads_dir,
        draft_dir=draft_dir,
        public_dir=public_dir,
        public_root=public_root,
    )


def resolve_orchestrator_desk_dir(root_path: str, orchestrator_conversation_id: int) -> Path:
    """总管共享桌根，按总管会话隔离。全队（总管 + 被派员工）共享这一张桌。"""
    desk = Path(root_path) / "orchestrator-desk" / f"conv-{orchestrator_conversation_id}"
    desk.mkdir(parents=True, exist_ok=True)
    return desk


def orchestrator_task_subdir(desk_dir: Path, task_id: int) -> Path:
    """某子任务在共享桌内的写子目录（防撞名）。"""
    return desk_dir / f"task-{task_id}"
