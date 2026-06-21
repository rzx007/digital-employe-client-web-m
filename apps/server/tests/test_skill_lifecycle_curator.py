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
