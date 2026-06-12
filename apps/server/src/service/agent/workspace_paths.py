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
    public_dir: Path      # $PUBLIC_DIR 写自己公共子区
    public_root: Path     # $PUBLIC_ROOT 读全部公共


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
    base_dir: Path,
) -> WorkspaceDirs:
    """解析员工工作空间 + 公共区的五个目录（不创建目录，纯计算）。"""
    root = Path(root_path) if root_path else Path(base_dir)
    owner = _owner_token(employee_id)
    conv_seg = f"conv-{conversation_id}" if conversation_id else "_scratch"

    public_root = root / "shared"
    public_dir = public_root / owner / conv_seg
    workspace_dir = root / owner / "artifacts"
    conv_artifacts = workspace_dir / conv_seg

    if shared_artifacts_dir:
        artifacts_dir = Path(shared_artifacts_dir)
    else:
        artifacts_dir = conv_artifacts
    uploads_dir = conv_artifacts / "uploads"

    return WorkspaceDirs(
        artifacts_dir=artifacts_dir,
        workspace_dir=workspace_dir,
        uploads_dir=uploads_dir,
        public_dir=public_dir,
        public_root=public_root,
    )
