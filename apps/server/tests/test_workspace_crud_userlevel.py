"""Task 5.1：用户级工作空间 CRUD（列/建空/删）+ 删除时仅清项目级行。"""

from __future__ import annotations


def test_list_user_workspaces_scoped(db_session):
    from src.models.workspace import Workspace
    from src.service.workspace_service import WorkspaceService

    db_session.add_all(
        [
            Workspace(name="a", root_path="/tmp/a", user_id="u1"),
            Workspace(name="b", root_path="/tmp/b", user_id="u1"),
            Workspace(name="c", root_path="/tmp/c", user_id="u2"),
        ]
    )
    db_session.commit()
    out = WorkspaceService.list_user_workspaces(db_session, "u1")
    assert {w.name for w in out} == {"a", "b"}


def test_ensure_user_default_workspace_with_multiple(db_session):
    """回归：用户有多个工作空间（新外部文件夹特性后合法）时，ensure_user_default_workspace
    不得因 scalar_one_or_none 抛 MultipleResultsFound；确定性返回最早（主）工作空间。
    复现 /workspaces/my 500：user_id=1 同时拥有 app 托管 + 外部文件夹两个工作空间。"""
    from src.models.workspace import Workspace
    from src.service.workspace_service import WorkspaceService

    primary = Workspace(name="主", root_path="/tmp/p", user_id="u1")
    external = Workspace(name="外部", root_path="/tmp/ext", user_id="u1")
    db_session.add_all([primary, external])
    db_session.commit()

    ws = WorkspaceService.ensure_user_default_workspace(db_session, "u1")
    assert ws.id == primary.id  # 最早 id = 主工作空间


def test_create_user_workspace_empty(db_session):
    from src.models.employee import Employee
    from src.service.workspace_service import WorkspaceService

    ws = WorkspaceService.create_user_workspace(
        db_session, "u1", name="新项目", root_path=None
    )
    assert ws.id is not None
    assert ws.user_id == "u1"
    assert ws.name == "新项目"
    # 新建=空项目：不播种员工
    employees = db_session.query(Employee).filter(Employee.workspace_id == ws.id).all()
    assert employees == []


def test_delete_workspace_purges_project_rows_keeps_user_resources(db_session):
    from src.models.conversation import Conversation
    from src.models.employee import Employee
    from src.models.employee_task import EmployeeTask
    from src.models.workspace import Workspace
    from src.service.workspace_service import WorkspaceService

    ws = Workspace(name="w", root_path="/tmp/w", user_id="u1")
    db_session.add(ws)
    db_session.flush()
    emp = Employee(workspace_id=ws.id, user_id="u1", employee_code="e", name="E")
    db_session.add(emp)
    conv = Conversation(
        workspace_id=ws.id, user_id="u1", target_type="curator", target_id=1
    )
    db_session.add(conv)
    task = EmployeeTask(workspace_id=ws.id, employee_id=1, task_name="t")
    db_session.add(task)
    db_session.commit()
    emp_id, conv_id, task_id = emp.id, conv.id, task.id

    WorkspaceService.delete_workspace(db_session, ws.id)
    db_session.expire_all()

    assert db_session.get(Employee, emp_id) is not None  # user-level kept
    assert db_session.get(Conversation, conv_id) is not None  # user-level kept
    assert db_session.get(EmployeeTask, task_id) is None  # project-level purged
    assert db_session.get(Workspace, ws.id) is None
