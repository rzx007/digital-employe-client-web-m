from src.service.agent.update_skill_tool import (
    create_update_skill_tool,
    _backup_skill_version_private,
)


def test_rejects_skill_not_loaded():
    tool = create_update_skill_tool(employee_id=1, available_skills=["pptx", "xlsx"])
    out = tool.invoke({"skill_name": "not-loaded", "new_content": "x", "reason": "r"})
    assert "拒绝" in out and "not-loaded" in out


def test_applies_update_to_private_copy_only(db_session, tmp_path, monkeypatch):
    """改技能只写调用者自己的私有副本，不写库、不广播；标记 locallyModified。"""
    from src.models.employee import Employee
    from src.service.employee_service import EmployeeService
    from src.service import skill_provenance
    import src.service.local_skill_service as lss
    import src.service.employee_service as es

    monkeypatch.setattr(EmployeeService, "_resolve_skill_root", staticmethod(lambda: tmp_path))
    # 库写入与广播都不应发生：触发即断言失败
    monkeypatch.setattr(
        lss.LocalSkillService, "update_local_skill",
        staticmethod(lambda *a, **k: (_ for _ in ()).throw(AssertionError("库不应被写"))),
    )
    monkeypatch.setattr(
        es.EmployeeService, "sync_local_skill_to_assignees",
        staticmethod(lambda *a, **k: (_ for _ in ()).throw(AssertionError("不应广播"))),
    )
    monkeypatch.setattr("src.db.session.get_session_local", lambda: (lambda: db_session))

    emp = Employee(workspace_id=7, user_id="u1", name="员工", employee_code="c1")
    db_session.add(emp); db_session.commit(); db_session.refresh(emp)
    d = tmp_path / str(emp.id) / "skills" / "pptx"
    d.mkdir(parents=True)
    (d / "SKILL.md").write_text("# old", encoding="utf-8")
    skill_provenance.write_origin(d, origin="assigned", skill_id=3)

    tool = create_update_skill_tool(employee_id=emp.id, available_skills=["pptx"])
    out = tool.invoke({"skill_name": "pptx", "new_content": "NEW", "reason": "缺步骤"})

    assert "仅你自己的副本" in out
    assert "失败" not in out
    assert (d / "SKILL.md").read_text(encoding="utf-8") == "NEW"
    assert skill_provenance.read_origin(d).locally_modified is True


def test_rejects_missing_private_copy(db_session, tmp_path, monkeypatch):
    """私有副本不存在时拒绝（替代旧 null-user_id 守卫：新流程不再依赖 user_id）。"""
    from src.models.employee import Employee
    from src.service.employee_service import EmployeeService

    monkeypatch.setattr(EmployeeService, "_resolve_skill_root", staticmethod(lambda: tmp_path))
    monkeypatch.setattr("src.db.session.get_session_local", lambda: (lambda: db_session))

    emp = Employee(workspace_id=7, user_id=None, name="员工", employee_code="c2")
    db_session.add(emp); db_session.commit(); db_session.refresh(emp)

    tool = create_update_skill_tool(employee_id=emp.id, available_skills=["pptx"])
    out = tool.invoke({"skill_name": "pptx", "new_content": "X", "reason": "r"})
    assert "拒绝" in out and "私有副本不存在" in out


def test_employee_module_wires_update_skill():
    # 静态断言：employee.py 源码确实 import 了工厂（接线证据，非恒真占位）
    import inspect
    import src.service.agent.employee as emp_mod
    src = inspect.getsource(emp_mod)
    assert "create_update_skill_tool" in src
    assert "from src.service.agent.update_skill_tool import create_update_skill_tool" in src


def test_fork_from_employee_copy_when_no_library(monkeypatch, tmp_path):
    """远程直分配技能（无库文件）应从员工私有副本 fork 到工作区技能库。"""
    from src.service.local_skill_service import LocalSkillService
    from src.service.employee_service import EmployeeService

    # 把 local_skills_path 和 skill_path 都指到 tmp_path 下的子目录
    local_skills_root = tmp_path / "local-skills"
    skill_path_root = tmp_path / "skill-path"
    local_skills_root.mkdir(parents=True)
    skill_path_root.mkdir(parents=True)

    # 取真实 settings 对象，用 monkeypatch 改属性（与 test_orchestrator_self_skills.py 同一模式）
    from src.core.config import get_settings
    settings = get_settings()
    monkeypatch.setattr(settings, "local_skills_path", str(local_skills_root))
    monkeypatch.setattr(settings, "skill_path", str(skill_path_root))

    workspace_id = 11
    employee_id = 42
    skill_name = "remote-x"

    # Arrange: 确认工作区库和内置都没有该技能（tmp 目录是空的，已满足）
    workspace_dir = local_skills_root / str(workspace_id) / skill_name
    assert not workspace_dir.exists()
    builtin_dir = local_skills_root / "builtin" / skill_name
    assert not builtin_dir.exists()

    # 创建员工私有副本
    private_dir = skill_path_root / str(employee_id) / "skills" / skill_name
    private_dir.mkdir(parents=True)
    skill_md_content = "---\nname: remote-x\ndescription: 远程技能\n---\n# Remote X\n"
    (private_dir / LocalSkillService.SKILL_MD_NAME).write_text(skill_md_content, encoding="utf-8")

    # Act
    result = LocalSkillService.ensure_editable_from_employee_copy(
        skill_name, workspace_id, employee_id
    )

    # Assert: 返回工作区目录
    assert result is not None
    assert result == workspace_dir

    # SKILL.md 已复制到工作区库
    forked_skill_md = workspace_dir / LocalSkillService.SKILL_MD_NAME
    assert forked_skill_md.exists()
    assert forked_skill_md.read_text(encoding="utf-8") == skill_md_content

    # .skill-meta.json 存在且含 localId
    import json
    meta_file = workspace_dir / LocalSkillService.META_FILE_NAME
    assert meta_file.exists()
    meta = json.loads(meta_file.read_text(encoding="utf-8"))
    assert "localId" in meta
    assert meta["localId"] < 0  # 本地技能 id 为负数
    assert meta["skillName"] == skill_name
    assert "fork:employee:" in meta.get("sourceFileName", "")


def test_ensure_editable_returns_workspace_dir_when_exists(monkeypatch, tmp_path):
    """工作区技能库已有副本时，ensure_editable_from_employee_copy 直接返回该目录（不 fork）。"""
    from src.service.local_skill_service import LocalSkillService

    local_skills_root = tmp_path / "local-skills"
    skill_path_root = tmp_path / "skill-path"
    local_skills_root.mkdir(parents=True)
    skill_path_root.mkdir(parents=True)

    from src.core.config import get_settings
    settings = get_settings()
    monkeypatch.setattr(settings, "local_skills_path", str(local_skills_root))
    monkeypatch.setattr(settings, "skill_path", str(skill_path_root))

    workspace_id = 11
    employee_id = 42
    skill_name = "ws-x"

    # Arrange: 工作区库已有副本
    workspace_dir = local_skills_root / str(workspace_id) / skill_name
    workspace_dir.mkdir(parents=True)
    (workspace_dir / LocalSkillService.SKILL_MD_NAME).write_text(
        "# WS-X\n", encoding="utf-8"
    )

    # Act
    result = LocalSkillService.ensure_editable_from_employee_copy(
        skill_name, workspace_id, employee_id
    )

    # Assert: 直接返回工作区目录，内容未变
    assert result == workspace_dir
    assert (workspace_dir / LocalSkillService.SKILL_MD_NAME).read_text(encoding="utf-8") == "# WS-X\n"


def test_ensure_editable_returns_none_when_builtin_exists(monkeypatch, tmp_path):
    """内置技能存在（无工作区副本）时，ensure_editable_from_employee_copy 返回 None。"""
    from src.service.local_skill_service import LocalSkillService

    local_skills_root = tmp_path / "local-skills"
    skill_path_root = tmp_path / "skill-path"
    local_skills_root.mkdir(parents=True)
    skill_path_root.mkdir(parents=True)

    from src.core.config import get_settings
    settings = get_settings()
    monkeypatch.setattr(settings, "local_skills_path", str(local_skills_root))
    monkeypatch.setattr(settings, "skill_path", str(skill_path_root))

    workspace_id = 11
    employee_id = 42
    skill_name = "bi-x"

    # Arrange: 内置有副本，工作区库无
    builtin_dir = local_skills_root / "builtin" / skill_name
    builtin_dir.mkdir(parents=True)
    (builtin_dir / LocalSkillService.SKILL_MD_NAME).write_text(
        "# BI-X\n", encoding="utf-8"
    )
    workspace_dir = local_skills_root / str(workspace_id) / skill_name
    assert not workspace_dir.exists()

    # Act
    result = LocalSkillService.ensure_editable_from_employee_copy(
        skill_name, workspace_id, employee_id
    )

    # Assert: 返回 None，交给 update_local_skill 处理内置 fork
    assert result is None


# ---------------------------------------------------------------------------
# Task A-2: backup + restore tests
# ---------------------------------------------------------------------------

def _settings_fixture(monkeypatch, tmp_path):
    """把 local_skills_path 重定向到 tmp_path，返回 (local_skills_root, settings)。"""
    from src.core.config import get_settings
    local_skills_root = tmp_path / "local-skills"
    local_skills_root.mkdir(parents=True)
    settings = get_settings()
    monkeypatch.setattr(settings, "local_skills_path", str(local_skills_root))
    return local_skills_root, settings


def test_backup_written_before_overwrite(tmp_path):
    """私有副本已有 SKILL.md 时，_backup_skill_version_private 应在 .history/ 写入旧内容并返回时间戳。"""
    skill_dir = tmp_path / "my-skill"
    skill_dir.mkdir(parents=True)
    old_content = "# OLD CONTENT\n旧版本\n"
    (skill_dir / "SKILL.md").write_text(old_content, encoding="utf-8")

    # Act
    ts = _backup_skill_version_private(skill_dir)

    # Assert: 返回非空时间戳，格式 YYYYmmdd-HHMMSS-ffffff
    assert ts is not None
    import re
    assert re.fullmatch(r"\d{8}-\d{6}-\d{6}", ts), f"unexpected ts format: {ts}"

    # .history/<ts>.md 存在且内容是旧的
    history_file = skill_dir / ".history" / f"{ts}.md"
    assert history_file.exists(), f"history file not found: {history_file}"
    assert history_file.read_text(encoding="utf-8") == old_content


def test_backup_skipped_when_no_skill_md(tmp_path):
    """私有副本无 SKILL.md 时，_backup_skill_version_private 应返回 None 且不创建 .history。"""
    skill_dir = tmp_path / "no-md-skill"
    skill_dir.mkdir(parents=True)

    # Act
    ts = _backup_skill_version_private(skill_dir)

    # Assert: 返回 None，没有创建 .history
    assert ts is None
    assert not (skill_dir / ".history").exists()


def test_restore_endpoint(monkeypatch, tmp_path):
    """POST /skills/local/{skill_name}/restore 应读取 .history 备份并回写 SKILL.md。"""
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from src.api.skill_api import router
    from src.service.local_skill_service import LocalSkillService

    local_skills_root, _ = _settings_fixture(monkeypatch, tmp_path)

    # patch get_workspace_id_from_request to return fixed workspace_id
    # (must patch in the skill_api module's namespace since it's imported there)
    monkeypatch.setattr(
        "src.api.skill_api.get_workspace_id_from_request",
        lambda req: 5,
    )
    # patch get_user_id in the same namespace
    monkeypatch.setattr(
        "src.api.skill_api.get_user_id",
        lambda req: "u1",
    )
    # patch sync to avoid DB
    monkeypatch.setattr(
        "src.service.employee_service.EmployeeService.sync_local_skill_to_assignees",
        lambda db, **kw: 0,
    )
    # patch get_db (yields a dummy session)
    class _FakeDB:
        def close(self): ...

    def _fake_get_db():
        yield _FakeDB()

    monkeypatch.setattr("src.api.skill_api.get_db", _fake_get_db)

    workspace_id = 5
    skill_name = "restore-skill"

    # Arrange: workspace skill dir with current SKILL.md + a backup in .history
    ws_skill_dir = local_skills_root / str(workspace_id) / skill_name
    ws_skill_dir.mkdir(parents=True)
    old_content = "# RESTORED CONTENT\n旧版本\n"
    current_content = "# CURRENT\n新版本\n"
    (ws_skill_dir / LocalSkillService.SKILL_MD_NAME).write_text(current_content, encoding="utf-8")
    history_dir = ws_skill_dir / ".history"
    history_dir.mkdir(parents=True)
    version = "20260101-120000-000000"
    (history_dir / f"{version}.md").write_text(old_content, encoding="utf-8")

    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)

    resp = client.post(
        f"/skills/local/{skill_name}/restore",
        json={"version": version},
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["data"]["restoredVersion"] == version

    # SKILL.md should now contain old_content
    actual = (ws_skill_dir / LocalSkillService.SKILL_MD_NAME).read_text(encoding="utf-8")
    assert actual == old_content


def test_restore_endpoint_version_not_found(monkeypatch, tmp_path):
    """合法格式但不存在的 version 应返回 404。"""
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from src.api.skill_api import router
    from src.service.local_skill_service import LocalSkillService

    local_skills_root, _ = _settings_fixture(monkeypatch, tmp_path)

    monkeypatch.setattr("src.api.skill_api.get_workspace_id_from_request", lambda req: 5)
    monkeypatch.setattr("src.api.skill_api.get_user_id", lambda req: "u1")
    monkeypatch.setattr(
        "src.service.employee_service.EmployeeService.sync_local_skill_to_assignees",
        lambda db, **kw: 0,
    )

    class _FakeDB:
        def close(self): ...

    def _fake_get_db():
        yield _FakeDB()

    monkeypatch.setattr("src.api.skill_api.get_db", _fake_get_db)

    workspace_id = 5
    skill_name = "restore-skill-404"

    # 工作区目录 + SKILL.md 存在，但 .history 里没有这个版本
    ws_skill_dir = local_skills_root / str(workspace_id) / skill_name
    ws_skill_dir.mkdir(parents=True)
    (ws_skill_dir / LocalSkillService.SKILL_MD_NAME).write_text("# CURRENT\n", encoding="utf-8")

    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)

    resp = client.post(
        f"/skills/local/{skill_name}/restore",
        json={"version": "99991231-235959-000000"},
    )
    assert resp.status_code == 404, resp.text


# ---------------------------------------------------------------------------
# Task A-2: 审计事件 tests
# ---------------------------------------------------------------------------

def test_audit_written_on_success(monkeypatch, tmp_path):
    """_write_skill_edit_audit 成功时应在 <brain>/skill_edits.jsonl 追加一条合法 JSON 行。"""
    import json
    from src.service.agent.update_skill_tool import _write_skill_edit_audit

    brain_dir = tmp_path / "brain-42"

    monkeypatch.setattr(
        "src.service.employee_service._growth_brain_root_for",
        lambda employee_id: brain_dir,
    )

    _write_skill_edit_audit(
        employee_id=42,
        skill_name="pptx",
        reason="缺步骤",
        new_content="# 新内容\n",
        backup_version="20260620-153000-123456",
    )

    audit_file = brain_dir / "skill_edits.jsonl"
    assert audit_file.exists(), "skill_edits.jsonl 应被创建"
    lines = audit_file.read_text(encoding="utf-8").strip().splitlines()
    assert len(lines) == 1, f"应有1行审计记录，实际: {len(lines)}"

    entry = json.loads(lines[0])
    assert entry["employee_id"] == 42
    assert entry["skill_name"] == "pptx"
    assert entry["reason"] == "缺步骤"
    assert "new_sha256" in entry and len(entry["new_sha256"]) == 16
    assert entry["backup_version"] == "20260620-153000-123456"
    assert "ts" in entry


def test_audit_best_effort_never_raises(monkeypatch):
    """_write_skill_edit_audit 在 brain 目录无法获取时不应抛出异常。"""
    from src.service.agent.update_skill_tool import _write_skill_edit_audit

    def _raise(_employee_id):
        raise RuntimeError("brain root unavailable")

    monkeypatch.setattr(
        "src.service.employee_service._growth_brain_root_for",
        _raise,
    )

    # 不应 raise
    result = _write_skill_edit_audit(
        employee_id=99,
        skill_name="xlsx",
        reason="测试",
        new_content="content",
        backup_version=None,
    )
    assert result is None


# ---------------------------------------------------------------------------
# Fix I-2: _clear_skill_hint tests
# ---------------------------------------------------------------------------

def test_clear_skill_hint_removes_file(monkeypatch, tmp_path):
    """_clear_skill_hint 应在成功更新后删除 <brain>/skill_hints/<skill_name>.md。"""
    from src.service.agent.update_skill_tool import _clear_skill_hint

    brain_dir = tmp_path / "brain-42"
    hint_dir = brain_dir / "skill_hints"
    hint_dir.mkdir(parents=True)
    hint_file = hint_dir / "pptx.md"
    hint_file.write_text("这个技能有问题", encoding="utf-8")

    monkeypatch.setattr(
        "src.service.employee_service._growth_brain_root_for",
        lambda employee_id: brain_dir,
    )

    _clear_skill_hint(42, "pptx")

    assert not hint_file.exists(), "hint 文件应已被删除"


def test_clear_skill_hint_best_effort_no_raise(monkeypatch):
    """_clear_skill_hint 在 brain 根不可获取时不应抛出异常（best-effort）。"""
    from src.service.agent.update_skill_tool import _clear_skill_hint

    def _raise(_employee_id):
        raise RuntimeError("brain root unavailable")

    monkeypatch.setattr(
        "src.service.employee_service._growth_brain_root_for",
        _raise,
    )

    # 不应 raise
    _clear_skill_hint(99, "pptx")


def test_restore_endpoint_traversal_rejected(monkeypatch, tmp_path):
    """路径穿越格式的 version 应被 Pydantic 校验拒绝（422）或边界检查拒绝（400）。"""
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from src.api.skill_api import router

    local_skills_root, _ = _settings_fixture(monkeypatch, tmp_path)

    monkeypatch.setattr("src.api.skill_api.get_workspace_id_from_request", lambda req: 5)
    monkeypatch.setattr("src.api.skill_api.get_user_id", lambda req: "u1")
    monkeypatch.setattr(
        "src.service.employee_service.EmployeeService.sync_local_skill_to_assignees",
        lambda db, **kw: 0,
    )

    class _FakeDB:
        def close(self): ...

    def _fake_get_db():
        yield _FakeDB()

    monkeypatch.setattr("src.api.skill_api.get_db", _fake_get_db)

    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)

    resp = client.post(
        "/skills/local/restore-skill/restore",
        json={"version": "../../x/SKILL"},
    )
    # Pydantic schema validator 会产生 422；边界检查会产生 400；二者均可接受
    assert resp.status_code in (400, 422), resp.text
