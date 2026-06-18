"""员工工作空间目录解析（纯函数）。

SP2 Task 3.1：产物三桶拍平为项目级，直接挂产物根（去 employee/conv 分层）——
artifacts=root/artifacts、uploads=root/uploads、draft=root/skills-draft；
workspace（读根）拍平为 root/artifacts（项目内人人读同一 artifacts 桶）。

SP2 Task 3.2a：消解 orchestrator-desk——产物已项目级扁平共享后，总管与全队
被派员工同写同读 root/artifacts，桌（shared_artifacts_dir/shared_workspace_root
override）冗余，连同 resolve_orchestrator_desk_dir/orchestrator_task_subdir 一并删除。

SP2 Task 3.2b：公共区收敛——不再有 per-employee 私有工作空间或公共子区，
全项目只有**一个**扁平共享产物区：$WORKSPACE_DIR / $PUBLIC_DIR / $PUBLIC_ROOT
全部 = root/artifacts，全队同写同读；同名覆盖按 last-write-wins（SP2 既定取舍）。
employee_id/conversation_id 入参随之删除（公共区收敛后无人再用）。
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from src.core.config import APP_DIR_NAME, app_data_dir


@dataclass(frozen=True)
class WorkspaceDirs:
    # 以下 6 字段在 SP2 3.2b 后归一到 3 个互异路径：
    artifacts_dir: Path   # $ARTIFACTS_DIR 项目级共享产物区 = root/artifacts
    workspace_dir: Path   # $WORKSPACE_DIR 同上（= root/artifacts）
    uploads_dir: Path     # $UPLOADS_DIR 拍平 = root/uploads
    draft_dir: Path       # 技能草稿目录（拍平 = root/skills-draft）
    public_dir: Path      # $PUBLIC_DIR 同 artifacts（= root/artifacts，单一共享区）
    public_root: Path     # $PUBLIC_ROOT 同 artifacts（= root/artifacts，单一共享区）


APP_PROJECTS_BASE = app_data_dir() / "projects"


def resolve_workspace_product_root(root_path: str) -> Path:
    """项目产物根。
    - app 托管目录（~/.boban-staff/projects/<id>/）：整个目录归 app，产物直接放其下。
    - 外部用户文件夹（用户手选的源码目录）：套隐藏子目录 .boban-staff/ 防污染其文件树。
    """
    p = Path(root_path)
    if p.is_relative_to(APP_PROJECTS_BASE):  # is_relative_to 已含相等（Py≥3.11）
        return p
    return p / f".{APP_DIR_NAME}"


def resolve_workspace_dirs(
    *,
    root_path: str | None,
    base_dir: Path,
) -> WorkspaceDirs:
    """解析项目级单一共享产物区 + uploads/draft 桶（不创建目录，纯计算）。

    SP2 3.1/3.2a/3.2b：项目内只有**一个**扁平共享产物区，
    $WORKSPACE_DIR / $PUBLIC_DIR / $PUBLIC_ROOT 全部 = root/artifacts，
    全队（总管 + 被派员工）同写同读、扁平无子目录分层；同名覆盖按
    last-write-wins（SP2 既定取舍）。uploads/draft 各自扁平直挂产物根。
    """
    root = Path(root_path) if root_path else Path(base_dir)

    # 项目级单一共享产物区：四个读写口子（artifacts/workspace/public_dir/public_root）归一
    artifacts_dir = root / "artifacts"
    workspace_dir = root / "artifacts"
    public_dir = root / "artifacts"
    public_root = root / "artifacts"

    # uploads / draft 各自扁平直挂产物根
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
