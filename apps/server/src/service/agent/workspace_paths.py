"""员工工作空间目录解析（纯函数）。

SP2 Task 3.1：产物三桶拍平为项目级，直接挂产物根（去 employee/conv 分层）——
artifacts=root/artifacts、uploads=root/uploads、draft=root/skills-draft；
workspace（读根）拍平为 root/artifacts（项目内人人读同一 artifacts 桶）。

SP2 Task 3.2a：消解 orchestrator-desk——产物已项目级扁平共享后，总管与全队
被派员工同写同读 root/artifacts，桌（shared_artifacts_dir/shared_workspace_root
override）冗余，连同 resolve_orchestrator_desk_dir/orchestrator_task_subdir 一并删除。

公共区 root/shared/employee-<owner>/conv-<cid> 仍为双层，留待 Task 3.2b 收口
（故 employee_id/conversation_id 入参暂留，公共区仍需）。
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class WorkspaceDirs:
    artifacts_dir: Path   # $ARTIFACTS_DIR 写产物（拍平=root/artifacts）
    workspace_dir: Path   # $WORKSPACE_DIR 读根（拍平=root/artifacts）
    uploads_dir: Path     # $UPLOADS_DIR 拍平=root/uploads
    draft_dir: Path       # 技能草稿目录（拍平=root/skills-draft）
    public_dir: Path      # $PUBLIC_DIR 写自己公共子区（Task 3.2b 收口）
    public_root: Path     # $PUBLIC_ROOT 读全部公共（Task 3.2b 收口）


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
    base_dir: Path,
) -> WorkspaceDirs:
    """解析产物三桶 + 公共区目录（不创建目录，纯计算）。

    Task 3.1/3.2a：三桶（artifacts/uploads/skills-draft）拍平直挂产物根，与
    employee/conv 无关；workspace（读根）拍平为 root/artifacts。共享桌已消解，
    全队（总管 + 被派员工）同写同读 root/artifacts。
    公共区（public_dir/public_root）仍按来源/会话分层，留待 Task 3.2b 收口。
    """
    root = Path(root_path) if root_path else Path(base_dir)
    owner = _owner_token(employee_id)
    conv_seg = f"conv-{conversation_id}" if conversation_id else "_scratch"

    # 公共区本任务不动（Task 3.2b 收口）：仍按来源/会话分层
    public_root = root / "shared"
    public_dir = public_root / owner / conv_seg

    # 三桶拍平直挂产物根；读根（workspace）= 写桶（artifacts）= root/artifacts
    artifacts_dir = root / "artifacts"
    workspace_dir = root / "artifacts"
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
