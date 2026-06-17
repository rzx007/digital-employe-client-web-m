"""员工工作空间目录解析（纯函数）。

SP2 Task 3.1：产物三桶拍平为项目级，直接挂产物根（去 employee/conv 分层）——
artifacts=root/artifacts、uploads=root/uploads、draft=root/skills-draft；
workspace（读根）拍平为 root/artifacts（项目内人人读同一 artifacts 桶）。

共享桌 override（resolve_orchestrator_desk_dir / orchestrator_task_subdir）与
公共区 root/shared/employee-<owner>/conv-<cid> 本任务暂不动，留待 Task 3.2 收口。
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class WorkspaceDirs:
    artifacts_dir: Path   # $ARTIFACTS_DIR 写产物（拍平=root/artifacts；desk override 时落桌）
    workspace_dir: Path   # $WORKSPACE_DIR 读根（拍平=root/artifacts；desk override 时为桌根）
    uploads_dir: Path     # $UPLOADS_DIR 拍平=root/uploads
    draft_dir: Path       # 技能草稿目录（拍平=root/skills-draft，不随共享桌/员工漂移）
    public_dir: Path      # $PUBLIC_DIR 写自己公共子区（Task 3.2 收口）
    public_root: Path     # $PUBLIC_ROOT 读全部公共（Task 3.2 收口）


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
    """解析产物三桶 + 公共区目录（不创建目录，纯计算）。

    Task 3.1：三桶（artifacts/uploads/skills-draft）拍平直挂产物根，与
    employee/conv 无关；workspace（读根）拍平为 root/artifacts。
    共享桌 override（shared_workspace_root/shared_artifacts_dir）与公共区保留原状。
    """
    root = Path(root_path) if root_path else Path(base_dir)
    owner = _owner_token(employee_id)
    conv_seg = f"conv-{conversation_id}" if conversation_id else "_scratch"

    # 公共区本任务不动（Task 3.2 收口）：仍按来源/会话分层
    public_root = root / "shared"
    public_dir = public_root / owner / conv_seg

    # 读根拍平为 root/artifacts；传入共享桌根则改读整张桌（desk override 保留）
    if shared_workspace_root is not None:
        workspace_dir = Path(shared_workspace_root)
    else:
        workspace_dir = root / "artifacts"

    # 写产物：默认拍平 root/artifacts；shared_artifacts_dir 注入则落共享桌子目录
    if shared_artifacts_dir:
        artifacts_dir = Path(shared_artifacts_dir)
    else:
        artifacts_dir = root / "artifacts"

    # uploads/草稿三桶拍平直挂产物根
    uploads_dir = root / "uploads"
    draft_dir = root / "skills-draft"

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
