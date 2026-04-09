import os
import unittest
from unittest.mock import patch

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from src import models  # noqa: F401
from src.core.config import get_settings
from src.db.base import Base
from src.models.workspace import Workspace
from src.service.workspace_service import WorkspaceService


class WorkspaceDefaultsTest(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)

    def tearDown(self) -> None:
        self.db.close()
        self.engine.dispose()
        get_settings.cache_clear()

    def test_default_workspace_id_falls_back_to_one(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            get_settings.cache_clear()
            settings = get_settings()

        self.assertEqual(settings.default_workspace_id, 1)

    def test_ensure_default_workspace_prefers_workspace_id_one(self) -> None:
        workspace_one = Workspace(id=1, name="默认工作空间", root_path="/tmp/workspace-1")
        workspace_two = Workspace(id=2, name="另一个工作空间", root_path="/tmp/workspace-2")
        self.db.add_all([workspace_one, workspace_two])
        self.db.commit()

        workspace = WorkspaceService.ensure_default_workspace(self.db)

        self.assertEqual(workspace.id, 1)

    def test_ensure_default_workspace_creates_workspace_id_one_when_missing(self) -> None:
        workspace_two = Workspace(id=2, name="另一个工作空间", root_path="/tmp/workspace-2")
        self.db.add(workspace_two)
        self.db.commit()

        workspace = WorkspaceService.ensure_default_workspace(self.db)

        self.assertEqual(workspace.id, 1)


if __name__ == "__main__":
    unittest.main()
