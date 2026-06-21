from datetime import datetime, timedelta

from src.service.learning import curator


def test_lifecycle_roundtrip_and_corrupt_tolerant(tmp_path):
    brain = tmp_path
    curator._save_lifecycle(brain, {"skills": {"pptx": {"status": "active", "pinned": True,
                                                        "archived_at": None, "restored_at": None}}})
    loaded = curator._load_lifecycle(brain)
    assert loaded["skills"]["pptx"]["pinned"] is True
    # 损坏文件 → 当空，不抛
    (brain / "skill_lifecycle.json").write_text("{ broken", encoding="utf-8")
    assert curator._load_lifecycle(brain) == {"skills": {}}


def test_compute_last_used_takes_max_of_sources():
    assign = datetime(2026, 1, 1)
    task = datetime(2026, 3, 1)
    rating = datetime(2026, 2, 1)
    restored = None
    assert curator._effective_last_used(assign, task, rating, restored) == task
    # 从未使用：只有分配时间
    assert curator._effective_last_used(assign, None, None, None) == assign


def test_effective_last_used_restored_wins():
    """restored_at 是四源中最新时，应成为 last_used。"""
    assert curator._effective_last_used(
        datetime(2026, 1, 1), datetime(2026, 2, 1), None, datetime(2026, 5, 1)
    ) == datetime(2026, 5, 1)


def test_age_status_thresholds():
    now = datetime(2026, 6, 1)
    assert curator._age_status(now - timedelta(days=5), now, pinned=False)[0] == "active"
    assert curator._age_status(now - timedelta(days=45), now, pinned=False)[0] == "stale"
    assert curator._age_status(now - timedelta(days=120), now, pinned=False)[0] == "archived"
    assert curator._age_status(now - timedelta(days=999), now, pinned=True)[0] == "active"


# ---------------------------------------------------------------------------
# Integration test: run_curator ages real skills via DB
# ---------------------------------------------------------------------------

def test_run_curator_ages_skills(db_session, workspace, tmp_path, monkeypatch):
    """run_curator reads EmployeeSkill + TaskExecutionLog from DB and writes lifecycle.json."""
    from datetime import timezone
    from sqlalchemy.orm import sessionmaker
    from tests.conftest import add_employee
    from src.models.employee_skill import EmployeeSkill
    from src.models.task_execution_log import TaskExecutionLog
    from src.models.workspace import CST

    # ── arrange ──────────────────────────────────────────────────────────────
    emp = add_employee(db_session, workspace.id, name="curator-test")
    now_cst = datetime.now(CST)

    # skill "old-a": assigned 120 days ago, no usage → should be archived
    old_created = now_cst - timedelta(days=120)
    skill_old = EmployeeSkill(
        workspace_id=workspace.id,
        employee_id=emp.id,
        user_id=emp.user_id,
        skill_id=101,
        skill_name="old-a",
        created_at=old_created,
    )
    db_session.add(skill_old)

    # skill "fresh-b": assigned today, with a TaskExecutionLog created today → active
    skill_fresh = EmployeeSkill(
        workspace_id=workspace.id,
        employee_id=emp.id,
        user_id=emp.user_id,
        skill_id=202,
        skill_name="fresh-b",
        created_at=now_cst,
    )
    db_session.add(skill_fresh)
    db_session.flush()

    # task log for fresh-b: skill_id=202, created today
    log = TaskExecutionLog(
        workspace_id=workspace.id,
        employee_id=emp.id,
        skill_id=202,
        task_name_snapshot="fresh task",
        run_status="success",
        started_at=now_cst,
        created_at=now_cst,
    )
    db_session.add(log)
    db_session.commit()

    # ── monkeypatches ────────────────────────────────────────────────────────
    # 1) point brain at tmp dir
    brain_dir = tmp_path / str(emp.id)
    brain_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(
        "src.service.learning.librarian._brain_root_for",
        lambda eid: brain_dir,
    )

    # 2) redirect get_session_local so run_curator opens the test DB
    engine = db_session.bind
    session_factory = sessionmaker(bind=engine)
    monkeypatch.setattr(
        "src.db.session.get_session_local",
        lambda: session_factory,
    )

    # ── act ───────────────────────────────────────────────────────────────────
    curator.run_curator(emp.id)

    # ── assert ───────────────────────────────────────────────────────────────
    lc = curator._load_lifecycle(brain_dir)
    assert lc["skills"]["old-a"]["status"] == "archived", f"old-a should be archived, got: {lc}"
    assert lc["skills"]["fresh-b"]["status"] == "active", f"fresh-b should be active, got: {lc}"


def test_archived_skill_names(tmp_path):
    curator._save_lifecycle(tmp_path, {"skills": {
        "a": {"status": "archived"}, "b": {"status": "active"}}})
    assert curator.archived_skill_names(tmp_path) == {"a"}


# ---------------------------------------------------------------------------
# Part A: restore_skill / set_pinned
# ---------------------------------------------------------------------------

def test_restore_and_pin(tmp_path):
    curator._save_lifecycle(tmp_path, {"skills": {"a": {"status": "archived", "pinned": False,
                                                        "archived_at": "x", "restored_at": None}}})
    curator.restore_skill(tmp_path, "a")
    lc = curator._load_lifecycle(tmp_path)["skills"]["a"]
    assert lc["status"] == "active" and lc["restored_at"]
    assert lc["archived_at"] is None

    curator.set_pinned(tmp_path, "a", True)
    assert curator._load_lifecycle(tmp_path)["skills"]["a"]["pinned"] is True

    # pin a skill not yet tracked → creates an entry
    curator.set_pinned(tmp_path, "new-skill", True)
    assert curator._load_lifecycle(tmp_path)["skills"]["new-skill"]["pinned"] is True


def test_restore_sets_active_and_restored_at(tmp_path):
    """restore_skill 应将 status 设为 active 并记录 restored_at 时间戳。"""
    curator._save_lifecycle(tmp_path, {"skills": {
        "s": {"status": "archived", "pinned": False, "archived_at": "2026-01-01T00:00:00",
              "restored_at": None}}})
    curator.restore_skill(tmp_path, "s")
    entry = curator._load_lifecycle(tmp_path)["skills"]["s"]
    assert entry["status"] == "active"
    assert entry["restored_at"] is not None
    assert entry["archived_at"] is None
    assert entry["pinned"] is False  # untouched


def test_set_pinned_creates_entry_for_unknown_skill(tmp_path):
    """set_pinned 对不存在的技能创建条目，默认 status=active。"""
    curator._save_lifecycle(tmp_path, {"skills": {}})
    curator.set_pinned(tmp_path, "brand-new", True)
    entry = curator._load_lifecycle(tmp_path)["skills"]["brand-new"]
    assert entry["pinned"] is True
    assert entry["status"] == "active"


def test_set_pinned_false(tmp_path):
    """set_pinned(False) 正确取消置顶。"""
    curator._save_lifecycle(tmp_path, {"skills": {"s": {"status": "active", "pinned": True}}})
    curator.set_pinned(tmp_path, "s", False)
    assert curator._load_lifecycle(tmp_path)["skills"]["s"]["pinned"] is False


# ---------------------------------------------------------------------------
# Part B+C: EmployeeService methods + skill_lifecycle in growth payload
# ---------------------------------------------------------------------------

def test_service_restore_skill_lifecycle(tmp_path, db_session, workspace, monkeypatch):
    """EmployeeService.restore_skill_lifecycle 写回 lifecycle.json + 返回正确 dict。"""
    from tests.conftest import add_employee
    from src.service import employee_service as es

    emp = add_employee(db_session, workspace.id, name="restore-test")
    brain_dir = tmp_path / str(emp.id)
    brain_dir.mkdir(parents=True, exist_ok=True)

    # 预置一个已归档技能
    curator._save_lifecycle(brain_dir, {"skills": {
        "pptx": {"status": "archived", "pinned": False, "archived_at": "x", "restored_at": None}
    }})

    monkeypatch.setattr(es, "_growth_brain_root_for", lambda eid: brain_dir)

    result = es.EmployeeService.restore_skill_lifecycle(emp.id, "pptx")
    assert result["skillName"] == "pptx"
    assert result["status"] == "active"

    entry = curator._load_lifecycle(brain_dir)["skills"]["pptx"]
    assert entry["status"] == "active"
    assert entry["restored_at"] is not None


def test_service_set_skill_pinned(tmp_path, db_session, workspace, monkeypatch):
    """EmployeeService.set_skill_pinned 写回 lifecycle.json。"""
    from tests.conftest import add_employee
    from src.service import employee_service as es

    emp = add_employee(db_session, workspace.id, name="pin-test")
    brain_dir = tmp_path / str(emp.id)
    brain_dir.mkdir(parents=True, exist_ok=True)

    monkeypatch.setattr(es, "_growth_brain_root_for", lambda eid: brain_dir)

    result = es.EmployeeService.set_skill_pinned(emp.id, "xlsx", True)
    assert result["skillName"] == "xlsx"
    assert result["pinned"] is True

    entry = curator._load_lifecycle(brain_dir)["skills"]["xlsx"]
    assert entry["pinned"] is True
    assert entry["status"] == "active"


def test_service_skill_lifecycle_validates_name(tmp_path, db_session, workspace, monkeypatch):
    """skill_name 含路径穿越字符（../../x）时 restore/pin 应抛 HTTPException (400)。"""
    from tests.conftest import add_employee
    from src.service import employee_service as es
    from fastapi import HTTPException

    emp = add_employee(db_session, workspace.id, name="traversal-test")
    brain_dir = tmp_path / str(emp.id)
    brain_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(es, "_growth_brain_root_for", lambda eid: brain_dir)

    import pytest as _pytest
    with _pytest.raises(HTTPException) as exc_info:
        es.EmployeeService.restore_skill_lifecycle(emp.id, "../../etc/passwd")
    assert exc_info.value.status_code == 400

    with _pytest.raises(HTTPException) as exc_info2:
        es.EmployeeService.set_skill_pinned(emp.id, "../../etc/passwd", True)
    assert exc_info2.value.status_code == 400


def test_growth_brain_includes_skill_lifecycle(tmp_path, db_session, workspace, monkeypatch):
    """build_employee_growth_brain 应将 skill_lifecycle 聚合进返回 dict。"""
    from tests.conftest import add_employee
    from src.service import employee_service as es

    emp = add_employee(db_session, workspace.id, name="lifecycle-brain")
    brain_dir = tmp_path / str(emp.id)
    brain_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(es, "_growth_brain_root_for", lambda eid: brain_dir)

    curator._save_lifecycle(brain_dir, {"skills": {
        "pptx": {"status": "archived", "pinned": False, "archived_at": "x", "restored_at": None},
        "xlsx": {"status": "active", "pinned": True, "archived_at": None, "restored_at": None},
    }})

    result = es.EmployeeService.build_employee_growth_brain(db_session, emp.id)

    assert "skill_lifecycle" in result
    lc = result["skill_lifecycle"]
    assert lc["pptx"]["status"] == "archived"
    assert lc["pptx"]["pinned"] is False
    assert lc["xlsx"]["status"] == "active"
    assert lc["xlsx"]["pinned"] is True


def test_growth_brain_skill_lifecycle_missing_is_empty(tmp_path, db_session, workspace, monkeypatch):
    """lifecycle.json 不存在时 skill_lifecycle 应为空 dict，不报错。"""
    from tests.conftest import add_employee
    from src.service import employee_service as es

    emp = add_employee(db_session, workspace.id, name="no-lifecycle")
    brain_dir = tmp_path / str(emp.id)
    brain_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(es, "_growth_brain_root_for", lambda eid: brain_dir)

    result = es.EmployeeService.build_employee_growth_brain(db_session, emp.id)
    assert result["skill_lifecycle"] == {}


def test_endpoint_restore_skill(tmp_path, db_session, workspace, monkeypatch):
    """endpoint: POST /employees/{id}/growth/skills/{name}/restore 返回 status=active。"""
    from tests.conftest import add_employee
    from src.service import employee_service as es
    from src.api import employee_api

    emp = add_employee(db_session, workspace.id, name="ep-restore")
    brain_dir = tmp_path / str(emp.id)
    brain_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(es, "_growth_brain_root_for", lambda eid: brain_dir)

    curator._save_lifecycle(brain_dir, {"skills": {
        "pptx": {"status": "archived", "pinned": False, "archived_at": "x", "restored_at": None}
    }})

    resp = employee_api.restore_skill_lifecycle(emp.id, "pptx")
    assert resp.data["status"] == "active"
    assert curator._load_lifecycle(brain_dir)["skills"]["pptx"]["status"] == "active"


def test_endpoint_pin_skill(tmp_path, db_session, workspace, monkeypatch):
    """endpoint: POST /employees/{id}/growth/skills/{name}/pin 置顶后 lifecycle.json 更新。"""
    from tests.conftest import add_employee
    from src.service import employee_service as es
    from src.api import employee_api
    from src.schemas.employee import SkillPinRequest

    emp = add_employee(db_session, workspace.id, name="ep-pin")
    brain_dir = tmp_path / str(emp.id)
    brain_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(es, "_growth_brain_root_for", lambda eid: brain_dir)

    resp = employee_api.set_skill_pinned(emp.id, "xlsx", SkillPinRequest(pinned=True))
    assert resp.data["pinned"] is True
    assert curator._load_lifecycle(brain_dir)["skills"]["xlsx"]["pinned"] is True


def test_endpoint_pin_path_traversal_rejected(tmp_path, db_session, workspace, monkeypatch):
    """path traversal skill_name via the endpoint → 400."""
    from tests.conftest import add_employee
    from src.service import employee_service as es
    from src.api import employee_api
    from src.schemas.employee import SkillPinRequest
    from fastapi import HTTPException
    import pytest as _pytest

    emp = add_employee(db_session, workspace.id, name="ep-traversal")
    brain_dir = tmp_path / str(emp.id)
    brain_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(es, "_growth_brain_root_for", lambda eid: brain_dir)

    with _pytest.raises(HTTPException) as exc_info:
        employee_api.set_skill_pinned(emp.id, "../../etc/passwd", SkillPinRequest(pinned=True))
    assert exc_info.value.status_code == 400

    with _pytest.raises(HTTPException) as exc_info2:
        employee_api.restore_skill_lifecycle(emp.id, "../../etc/passwd")
    assert exc_info2.value.status_code == 400
