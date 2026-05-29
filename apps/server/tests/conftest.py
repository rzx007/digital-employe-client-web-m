"""Pytest 公共 fixture：内存 SQLite + 工作空间。"""

from __future__ import annotations

import tempfile
from collections.abc import Generator

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from src import models  # noqa: F401
from src.db.base import Base
from src.models.employee import Employee
from src.models.workspace import Workspace


@pytest.fixture()
def db_engine():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(engine)
    try:
        yield engine
    finally:
        engine.dispose()


@pytest.fixture()
def db_session(db_engine) -> Generator[Session, None, None]:
    session = sessionmaker(bind=db_engine)()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture()
def workspace(db_session: Session) -> Workspace:
    root = tempfile.mkdtemp(prefix="de-test-ws-")
    ws = Workspace(id=1, name="Test Workspace", root_path=root)
    db_session.add(ws)
    db_session.commit()
    db_session.refresh(ws)
    return ws


@pytest.fixture()
def patched_recruitment_db(db_engine, monkeypatch):
    """让 recruitment 模块的 get_session_local 使用测试库。"""
    session_factory = sessionmaker(bind=db_engine)
    monkeypatch.setattr(
        "src.service.agent.orchestrator.recruitment.get_session_local",
        lambda: session_factory,
    )
    return session_factory


@pytest.fixture()
def patched_task_mutations_db(db_engine, monkeypatch):
    """让 task_mutations 模块的 get_session_local 使用测试库。"""
    session_factory = sessionmaker(bind=db_engine)
    monkeypatch.setattr(
        "src.service.agent.orchestrator.task_mutations.get_session_local",
        lambda: session_factory,
    )
    return session_factory


@pytest.fixture()
def patched_employee_tools_db(db_engine, monkeypatch):
    """让 employee_tools 模块的 get_session_local 使用测试库。"""
    session_factory = sessionmaker(bind=db_engine)
    monkeypatch.setattr(
        "src.service.agent.orchestrator.employee_tools.get_session_local",
        lambda: session_factory,
    )
    return session_factory


def add_employee(
    db: Session,
    workspace_id: int,
    *,
    name: str,
    is_curator: bool = False,
    description: str | None = "测试描述",
) -> Employee:
    employee = Employee(
        workspace_id=workspace_id,
        employee_code=f"code-{name}",
        name=name,
        description=description,
        is_curator=is_curator,
    )
    db.add(employee)
    db.commit()
    db.refresh(employee)
    return employee
