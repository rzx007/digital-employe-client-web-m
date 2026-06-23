from __future__ import annotations

import logging
from pathlib import Path

from fastapi import HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from src.core.config import get_settings
from src.models.workspace import Workspace
from src.schemas.workspace import WorkspaceCreate, WorkspaceUpdate

logger = logging.getLogger(__name__)


def _is_unsafe_rmtree_target(target: Path) -> bool:
    """拒绝删除文件系统根、托管基目录本身、或其任何祖先——防误删整个 projects 区。"""
    from src.service.agent import workspace_paths

    t = target.resolve()
    base = workspace_paths.APP_PROJECTS_BASE.resolve()
    if t == t.parent:  # 文件系统根（C:\ 或 /）
        return True
    if t == base or base.is_relative_to(t):  # base 本身或 base 的祖先
        return True
    return False


class WorkspaceService:
    @staticmethod
    def ensure_workspace_initialized(db: Session, workspace: Workspace) -> None:
        """新建工作空间=空项目：不再播种员工/任务（团队改为 per-用户，见 ensure_user_team）。"""
        return

    @staticmethod
    def _resolve_default_root() -> Path:
        settings = get_settings()
        configured = settings.default_workspace_root
        if configured:
            configured_path = Path(configured)
            if configured_path.exists():
                return configured_path

        install_anchor = Path(__file__).resolve().anchor
        if install_anchor:
            return Path(install_anchor)

        return Path(Path.cwd().anchor or str(Path.cwd()))

    @staticmethod
    def ensure_user_default_workspace(
        db: Session, user_id: str, username: str | None = None
    ) -> Workspace:
        """
        解析（或创建）用户的默认工作空间，不做任何播种。

        1. 如果已存在该用户的 workspace，直接返回
        2. 如果不存在：
           - 检查 workspace_id=1 是否未被认领（user_id IS NULL）
           - 是则认领该 workspace（将存量数据迁移给该用户）
           - 否则创建新 workspace，命名为 "<username>的工作空间" 或 "用户工作空间"
        """
        existing_workspace = db.execute(
            select(Workspace).where(Workspace.user_id == user_id)
        ).scalar_one_or_none()
        if existing_workspace:
            return existing_workspace

        # 尝试认领 workspace_id=1（如果还未被认领）
        default_workspace_id = get_settings().default_workspace_id
        default_workspace = db.get(Workspace, default_workspace_id)
        if default_workspace and default_workspace.user_id is None:
            default_workspace.user_id = user_id
            default_workspace.name = username + "的工作空间" if username else "用户工作空间"
            db.commit()
            db.refresh(default_workspace)
            return default_workspace

        # 创建新的用户专属 workspace：自动建托管项目目录（与 create_user_workspace 一致）。
        from src.service.agent.workspace_paths import APP_PROJECTS_BASE

        workspace_name = username + "的工作空间" if username else "用户工作空间"
        workspace = Workspace(
            name=workspace_name,
            root_path="",
            user_id=user_id,
        )
        db.add(workspace)
        db.flush()  # 拿自增 id 给托管目录命名
        managed_root = APP_PROJECTS_BASE / str(workspace.id)
        managed_root.mkdir(parents=True, exist_ok=True)
        workspace.root_path = str(managed_root)
        db.commit()
        db.refresh(workspace)
        return workspace

    @staticmethod
    def ensure_user_team(
        db: Session, user_id: str, workspace_id: int | None = None
    ) -> None:
        """per-用户播种团队（总管 + 内置员工），幂等（存在性按 user_id 判定）。

        员工改为用户级，NOT-NULL 的 workspace_id 此刻仅作装饰性盖戳：
        未显式给定时，解析到用户默认工作空间的 id。
        """
        from src.service.employee_service import EmployeeService

        if workspace_id is None:
            workspace_id = WorkspaceService.ensure_user_default_workspace(
                db, user_id
            ).id

        EmployeeService.ensure_builtin_seed_employees(db, user_id, workspace_id)
        EmployeeService.ensure_curator_employee(db, user_id, workspace_id)

    @staticmethod
    def get_or_create_user_workspace(
        db: Session, user_id: str, username: str | None = None
    ) -> Workspace:
        """获取或创建用户默认工作空间，并确保其团队已 per-用户播种。"""
        ws = WorkspaceService.ensure_user_default_workspace(db, user_id, username)
        WorkspaceService.ensure_user_team(db, user_id, ws.id)
        return ws

    @staticmethod
    def ensure_default_workspace(db: Session) -> Workspace:
        settings = get_settings()
        default_workspace_id = settings.default_workspace_id
        default_workspace_name = settings.default_workspace_name or "默认的工作空间"
        workspace = db.get(Workspace, default_workspace_id)
        if workspace:
            return workspace

        from src.service.agent.workspace_paths import APP_PROJECTS_BASE

        default_root = APP_PROJECTS_BASE / str(default_workspace_id)
        default_root.mkdir(parents=True, exist_ok=True)
        workspace = Workspace(
            id=default_workspace_id,
            name=default_workspace_name,
            root_path=str(default_root),
        )
        db.add(workspace)
        db.commit()
        db.refresh(workspace)
        return workspace

    @staticmethod
    def create_workspace(workspace_create: WorkspaceCreate, db: Session) -> Workspace:
        """创建工作空间，缺省参数时自动使用默认名称和默认根目录。"""
        settings = get_settings()
        default_workspace_name = settings.default_workspace_name or "默认的工作空间"
        # 这里需要做一下判断，如果传递过来的name和root_path都为空，则创建一个默认的工作空间
        if workspace_create.name is None and workspace_create.root_path is None:
            return WorkspaceService.ensure_default_workspace(db)
        if workspace_create.name is None:
            workspace_create.name = default_workspace_name
        if workspace_create.root_path is None:
            workspace_create.root_path = WorkspaceService._resolve_default_root()
        workspace = Workspace(name=workspace_create.name, root_path=str(workspace_create.root_path))
        db.add(workspace)
        db.commit()
        db.refresh(workspace)
        return workspace

    @staticmethod
    def list_workspaces(db: Session) -> list[Workspace]:
        return list[Workspace](db.scalars(select(Workspace).order_by(Workspace.id.desc())).all())

    @staticmethod
    def list_user_workspaces(db: Session, user_id: str) -> list[Workspace]:
        """列出指定用户拥有的所有工作空间（按 id 倒序）。"""
        return list[Workspace](
            db.scalars(
                select(Workspace)
                .where(Workspace.user_id == user_id)
                .order_by(Workspace.id.desc())
            ).all()
        )

    @staticmethod
    def create_user_workspace(
        db: Session,
        user_id: str,
        name: str | None,
        root_path: str | None,
    ) -> Workspace:
        """为用户新建一个空项目工作空间（不播种员工/任务）。

        - 未显式给 root_path：自动建托管项目目录 APP_PROJECTS_BASE/<id>/ 并 mkdir
          （需先 flush 拿到自增 id）。
        - 显式给外部 root_path（用户手选文件夹）：原样存储，不重定位、不 mkdir 其本体
          （用户拥有该目录；产物后续懒建在其 .boban-staff/ 子目录）。
        """
        from src.service.agent.workspace_paths import APP_PROJECTS_BASE

        settings = get_settings()
        workspace_name = name or settings.default_workspace_name or "新项目"
        explicit_root = bool(root_path)

        workspace = Workspace(
            name=workspace_name,
            root_path=str(root_path) if explicit_root else "",
            user_id=user_id,
        )
        db.add(workspace)
        if not explicit_root:
            # 托管目录需用自增 id 命名：先 flush 拿 id，再 mkdir 回填 root_path。
            db.flush()
            managed_root = APP_PROJECTS_BASE / str(workspace.id)
            managed_root.mkdir(parents=True, exist_ok=True)
            workspace.root_path = str(managed_root)
        db.commit()
        db.refresh(workspace)
        from src.service.chat_service import ChatService

        ChatService.ensure_curator_conversation(db, user_id, workspace.id)
        return workspace

    @staticmethod
    def get_workspace(db: Session, workspace_id: int) -> Workspace:
        workspace = db.get(Workspace, workspace_id)
        if not workspace:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="未找到工作空间。")
        return workspace

    @staticmethod
    def update_workspace(db: Session, workspace_id: int, payload: WorkspaceUpdate) -> Workspace:
        workspace = WorkspaceService.get_workspace(db, workspace_id)
        if payload.name is not None:
            workspace.name = payload.name
        if payload.root_path is not None:
            root = Path(payload.root_path)
            if not root.exists():
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="工作空间路径不存在。")
            workspace.root_path = str(root)
        db.commit()
        db.refresh(workspace)
        return workspace

    @staticmethod
    def delete_workspace(db: Session, workspace_id: int) -> None:
        """删除工作空间：显式清理项目级行 + 磁盘产物目录，永不触及用户级资源/外部文件。

        项目级（随空间删）：TaskExecutionLog / EmployeeTask / OrchestrationPlan / RecentContact。
        用户级（保留）：Employee / EmployeeSkill / EmployeeMcp / SkillRating / Conversation。

        磁盘产物（SP2）：
        - 托管目录（root_path 在 APP_PROJECTS_BASE 下）：整删 root_path 目录。
        - 外部用户文件夹：仅删 <root_path>/.boban-staff 子目录，永不触碰外部本体及用户文件。
        清理在 DB 行删除前进行且全程 try/except，磁盘失败绝不阻断 DB 删除。
        """
        import shutil

        from src.service.agent import workspace_paths
        from src.service.agent.workspace_paths import resolve_workspace_product_root

        workspace = WorkspaceService.get_workspace(db, workspace_id)

        # 先捕获 root_path（DB 行删除后 workspace 失效），再算产物目标。
        root_path = workspace.root_path
        if root_path:
            p = Path(root_path)
            # 在调用时按属性查 APP_PROJECTS_BASE（测试可 monkeypatch 模块属性命中托管分支）。
            if p.is_relative_to(workspace_paths.APP_PROJECTS_BASE):
                target = p  # 托管：整删
            else:
                target = resolve_workspace_product_root(root_path)  # 外部：仅 .boban-staff
            try:
                if target.exists():
                    if _is_unsafe_rmtree_target(target):
                        logger.error(
                            "delete_workspace: 拒绝删除危险目标 %s"
                            "（疑似托管基目录/根），跳过磁盘清理",
                            target,
                        )
                    else:
                        logger.warning("delete_workspace: 删除产物目录 %s", target)
                        shutil.rmtree(target, ignore_errors=True)
            except Exception:
                logger.warning(
                    "delete_workspace: 清理产物目录失败 %s", target, exc_info=True
                )

        from src.models.employee_task import EmployeeTask
        from src.models.orchestration_plan import OrchestrationPlan
        from src.models.recent_contact import RecentContact
        from src.models.task_execution_log import TaskExecutionLog

        # 先删执行日志再删任务（TaskExecutionLog.task_id 引用 employee_tasks）。
        # 运行时 FK OFF，顺序非强制，但为整洁仍按依赖顺序删。
        for model in (TaskExecutionLog, EmployeeTask, OrchestrationPlan, RecentContact):
            db.execute(delete(model).where(model.workspace_id == workspace_id))

        # 会话/员工/技能/评分是用户级，不删；其 workspace_id 仍指向已删空间
        # （FK 运行时 OFF，孤儿无害，仍按 user_id 出现在侧边栏；前端对已删项目名兜底）。
        db.delete(workspace)
        db.commit()
