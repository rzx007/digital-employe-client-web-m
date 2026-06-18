"""SP2 Task 3.3：删员工不再清理产物。

产物现为「项目共享」（同项目所有员工 + 总管共用 <product_root>/{artifacts,...}），
删单个员工只能删 DB 行 / 最近联系人 / 重排定时任务，绝不能动项目共享产物。
产物清理只在删工作空间时发生（见 test_workspace_delete_cleanup.py）。
"""

from __future__ import annotations

from src.service.agent.workspace_paths import resolve_workspace_product_root
from src.service.employee_service import EmployeeService
from tests.conftest import add_employee


def test_delete_employee_keeps_project_shared_products(db_session, workspace):
    # workspace fixture 的 root_path 是外部临时目录 → 产物根为 <root>/.boban-staff
    product_root = resolve_workspace_product_root(workspace.root_path)
    artifacts = product_root / "artifacts"
    artifacts.mkdir(parents=True, exist_ok=True)
    artifact_file = artifacts / "shared-output.txt"
    artifact_file.write_text("project-shared product, must survive")

    emp = add_employee(db_session, workspace.id, name="Carol")
    emp_id = emp.id

    EmployeeService.delete_employee(db_session, emp_id)

    # 员工 DB 行已删
    from src.models.employee import Employee

    assert db_session.get(Employee, emp_id) is None
    # 项目共享产物存活：删员工不得触碰产物（清理只随删项目发生）
    assert artifact_file.exists()
    assert artifact_file.read_text() == "project-shared product, must survive"
    assert artifacts.exists()
