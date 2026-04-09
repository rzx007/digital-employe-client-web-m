import unittest
from unittest.mock import patch

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from src import models  # noqa: F401
from src.db.base import Base
from src.models.employee import Employee
from src.models.workspace import Workspace
from src.server import initialize_default_workspace_employees


class ServerStartupInitializationTest(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)

    def tearDown(self) -> None:
        self.db.close()
        self.engine.dispose()

    def test_syncs_employees_when_table_is_empty(self) -> None:
        workspace = Workspace(name="默认工作空间", root_path="/tmp")
        self.db.add(workspace)
        self.db.commit()
        self.db.refresh(workspace)

        with patch("src.server.EmployeeService.sync_workspace_employees") as sync_mock:
            initialize_default_workspace_employees(self.db, workspace)

        sync_mock.assert_called_once_with(self.db, workspace)

    def test_skips_sync_when_employees_already_exist(self) -> None:
        workspace = Workspace(name="默认工作空间", root_path="/tmp")
        self.db.add(workspace)
        self.db.commit()
        self.db.refresh(workspace)

        employee = Employee(
            workspace_id=workspace.id,
            employee_code="测试员工",
            name="测试员工",
            skills_json="[]",
            meta_json="{}",
        )
        self.db.add(employee)
        self.db.commit()

        with patch("src.server.EmployeeService.sync_workspace_employees") as sync_mock:
            initialize_default_workspace_employees(self.db, workspace)

        sync_mock.assert_not_called()


if __name__ == "__main__":
    unittest.main()
