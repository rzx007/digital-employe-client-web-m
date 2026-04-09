import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from src import models  # noqa: F401
from src.db.base import Base
from src.models.workspace import Workspace
from src.service.employee_service import EmployeeService


class EmployeeSyncLocalEmployeesTest(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)

    def tearDown(self) -> None:
        self.db.close()
        self.engine.dispose()

    def test_sync_extracts_employees_under_repo_local_employees(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            workspace_root = tmp_path / "workspace-root"
            workspace_root.mkdir()

            workspace = Workspace(name="默认工作空间", root_path=str(workspace_root))
            self.db.add(workspace)
            self.db.commit()
            self.db.refresh(workspace)

            fake_zip = tmp_path / "employees.zip"
            fake_zip.write_bytes(b"zip")

            def fake_extract(_zip_path: Path, extract_dir: Path) -> Path:
                employee_dir = extract_dir / "测试员工"
                skills_dir = employee_dir / "skills" / "echo-test-skill"
                skills_dir.mkdir(parents=True, exist_ok=True)
                (skills_dir / "SKILL.md").write_text("# test\n", encoding="utf-8")
                (employee_dir / "employee.json").write_text(
                    json.dumps({"name": "测试员工", "description": "desc"}, ensure_ascii=False),
                    encoding="utf-8",
                )
                return extract_dir

            with patch("src.service.employee_service.EmployeeService._download_zip", return_value=fake_zip), patch(
                "src.service.employee_service.EmployeeService._extract_zip",
                side_effect=fake_extract,
            ), patch("pathlib.Path.cwd", return_value=tmp_path):
                synced = EmployeeService.sync_workspace_employees(self.db, workspace)

            self.assertEqual(len(synced), 1)
            expected_employee_dir = tmp_path / "local-employees" / "测试员工"
            expected_skills_dir = expected_employee_dir / "skills"
            self.assertTrue(expected_skills_dir.is_dir())

            employee = synced[0]
            skills = json.loads(employee.skills_json)
            self.assertEqual(skills, [{"skills_dir": str(expected_skills_dir)}])
            self.assertFalse((workspace_root / "employees").exists())

    def test_sync_flattens_wrapped_employees_directory(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            workspace_root = tmp_path / "workspace-root"
            workspace_root.mkdir()

            workspace = Workspace(name="默认工作空间", root_path=str(workspace_root))
            self.db.add(workspace)
            self.db.commit()
            self.db.refresh(workspace)

            fake_zip = tmp_path / "employees.zip"
            fake_zip.write_bytes(b"zip")

            def fake_extract(_zip_path: Path, extract_dir: Path) -> Path:
                employee_dir = extract_dir / "employees" / "测试员工"
                skills_dir = employee_dir / "skills" / "echo-test-skill"
                skills_dir.mkdir(parents=True, exist_ok=True)
                (skills_dir / "SKILL.md").write_text("# test\n", encoding="utf-8")
                (employee_dir / "employee.json").write_text(
                    json.dumps({"name": "测试员工", "description": "desc"}, ensure_ascii=False),
                    encoding="utf-8",
                )
                return extract_dir

            with patch("src.service.employee_service.EmployeeService._download_zip", return_value=fake_zip), patch(
                "src.service.employee_service.EmployeeService._extract_zip",
                side_effect=fake_extract,
            ), patch("pathlib.Path.cwd", return_value=tmp_path):
                synced = EmployeeService.sync_workspace_employees(self.db, workspace)

            self.assertEqual(len(synced), 1)
            expected_employee_dir = tmp_path / "local-employees" / "测试员工"
            expected_skills_dir = expected_employee_dir / "skills"
            self.assertTrue(expected_skills_dir.is_dir())
            self.assertFalse((tmp_path / "local-employees" / "employees").exists())

            employee = synced[0]
            skills = json.loads(employee.skills_json)
            self.assertEqual(skills, [{"skills_dir": str(expected_skills_dir)}])


if __name__ == "__main__":
    unittest.main()
