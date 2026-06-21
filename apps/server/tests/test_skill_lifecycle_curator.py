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

    result = es.EmployeeService.restore_skill_lifecycle(db_session, emp.id, "pptx")
    assert result["skillName"] == "pptx"
    assert result["status"] == "active"

    entry = curator._load_lifecycle(brain_dir)["skills"]["pptx"]
    assert entry["status"] == "active"
    assert entry["restored_at"] is not None


def test_service_restore_skill_lifecycle_unknown_employee(db_session):
    """restore_skill_lifecycle：不存在的 employee_id → 404。"""
    from src.service import employee_service as es
    from fastapi import HTTPException
    import pytest as _pytest

    with _pytest.raises(HTTPException) as exc_info:
        es.EmployeeService.restore_skill_lifecycle(db_session, 99999999, "pptx")
    assert exc_info.value.status_code == 404


def test_service_set_skill_pinned(tmp_path, db_session, workspace, monkeypatch):
    """EmployeeService.set_skill_pinned 写回 lifecycle.json。"""
    from tests.conftest import add_employee
    from src.service import employee_service as es

    emp = add_employee(db_session, workspace.id, name="pin-test")
    brain_dir = tmp_path / str(emp.id)
    brain_dir.mkdir(parents=True, exist_ok=True)

    monkeypatch.setattr(es, "_growth_brain_root_for", lambda eid: brain_dir)

    result = es.EmployeeService.set_skill_pinned(db_session, emp.id, "xlsx", True)
    assert result["skillName"] == "xlsx"
    assert result["pinned"] is True

    entry = curator._load_lifecycle(brain_dir)["skills"]["xlsx"]
    assert entry["pinned"] is True
    assert entry["status"] == "active"


def test_service_set_skill_pinned_unknown_employee(db_session):
    """set_skill_pinned：不存在的 employee_id → 404。"""
    from src.service import employee_service as es
    from fastapi import HTTPException
    import pytest as _pytest

    with _pytest.raises(HTTPException) as exc_info:
        es.EmployeeService.set_skill_pinned(db_session, 99999999, "xlsx", True)
    assert exc_info.value.status_code == 404


def test_service_skill_lifecycle_validates_name(tmp_path, db_session, workspace, monkeypatch):
    """skill_name 含路径穿越字符（../../x）时 restore/pin 应抛 HTTPException (400)。
    需要真实 employee_id，以便 get_employee 通过后才触发名称校验。
    """
    from tests.conftest import add_employee
    from src.service import employee_service as es
    from fastapi import HTTPException

    emp = add_employee(db_session, workspace.id, name="traversal-test")
    brain_dir = tmp_path / str(emp.id)
    brain_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(es, "_growth_brain_root_for", lambda eid: brain_dir)

    import pytest as _pytest
    with _pytest.raises(HTTPException) as exc_info:
        es.EmployeeService.restore_skill_lifecycle(db_session, emp.id, "../../etc/passwd")
    assert exc_info.value.status_code == 400

    with _pytest.raises(HTTPException) as exc_info2:
        es.EmployeeService.set_skill_pinned(db_session, emp.id, "../../etc/passwd", True)
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

    resp = employee_api.restore_skill_lifecycle(emp.id, "pptx", db_session)
    assert resp.data["status"] == "active"
    assert curator._load_lifecycle(brain_dir)["skills"]["pptx"]["status"] == "active"


def test_endpoint_restore_skill_unknown_employee(db_session):
    """endpoint restore：不存在的 employee_id → 404。"""
    from src.api import employee_api
    from fastapi import HTTPException
    import pytest as _pytest

    with _pytest.raises(HTTPException) as exc_info:
        employee_api.restore_skill_lifecycle(99999999, "pptx", db_session)
    assert exc_info.value.status_code == 404


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

    resp = employee_api.set_skill_pinned(emp.id, "xlsx", SkillPinRequest(pinned=True), db_session)
    assert resp.data["pinned"] is True
    assert curator._load_lifecycle(brain_dir)["skills"]["xlsx"]["pinned"] is True


def test_endpoint_pin_skill_unknown_employee(db_session):
    """endpoint pin：不存在的 employee_id → 404。"""
    from src.api import employee_api
    from src.schemas.employee import SkillPinRequest
    from fastapi import HTTPException
    import pytest as _pytest

    with _pytest.raises(HTTPException) as exc_info:
        employee_api.set_skill_pinned(99999999, "xlsx", SkillPinRequest(pinned=True), db_session)
    assert exc_info.value.status_code == 404


def test_endpoint_pin_path_traversal_rejected(tmp_path, db_session, workspace, monkeypatch):
    """path traversal skill_name via the endpoint → 400。
    需要真实 employee_id，以便 get_employee 通过后才触发名称校验。
    """
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
        employee_api.set_skill_pinned(emp.id, "../../etc/passwd", SkillPinRequest(pinned=True), db_session)
    assert exc_info.value.status_code == 400

    with _pytest.raises(HTTPException) as exc_info2:
        employee_api.restore_skill_lifecycle(emp.id, "../../etc/passwd", db_session)
    assert exc_info2.value.status_code == 400


# ---------------------------------------------------------------------------
# B-3: 近重复候选合并
# ---------------------------------------------------------------------------

def test_merge_near_dup_candidates(tmp_path):
    cand = tmp_path / "skill_candidates"
    cand.mkdir()
    (cand / "excel-export.md").write_text("---\nname: excel-export\n---\nA", encoding="utf-8")
    (cand / "export-excel.md").write_text("---\nname: export-excel\n---\nBB longer body", encoding="utf-8")
    (cand / "pdf-merge.md").write_text("---\nname: pdf-merge\n---\nC", encoding="utf-8")
    curator._merge_near_dup_candidates(tmp_path)
    remaining = sorted(p.name for p in cand.glob("*.md"))
    # excel-export 与 export-excel 是近义(同 token 集) → 合并为一；pdf-merge 保留
    assert len(remaining) == 2 and "pdf-merge.md" in remaining


def test_merge_near_dup_candidates_no_dir(tmp_path):
    """skill_candidates 目录不存在 → no-op，不报错。"""
    curator._merge_near_dup_candidates(tmp_path)  # should not raise


def test_merge_near_dup_candidates_single_file(tmp_path):
    """只有一个候选文件 → no-op。"""
    cand = tmp_path / "skill_candidates"
    cand.mkdir()
    (cand / "solo.md").write_text("---\nname: solo\n---\nonly one", encoding="utf-8")
    curator._merge_near_dup_candidates(tmp_path)
    assert list(cand.glob("*.md")) == [cand / "solo.md"]


def test_merge_near_dup_candidates_keeps_longest_content(tmp_path):
    """保留内容最长的候选；并追加亦见注记。"""
    cand = tmp_path / "skill_candidates"
    cand.mkdir()
    (cand / "excel-export.md").write_text("---\nname: excel-export\n---\nshort", encoding="utf-8")
    (cand / "export-excel.md").write_text("---\nname: export-excel\n---\n" + "x" * 100, encoding="utf-8")
    curator._merge_near_dup_candidates(tmp_path)
    remaining = list(cand.glob("*.md"))
    assert len(remaining) == 1
    kept = remaining[0]
    content = kept.read_text(encoding="utf-8")
    assert "亦见" in content


def test_merge_near_dup_candidates_deterministic_tiebreak(tmp_path):
    """内容等长时按 slug 字典序保留较小的那个。"""
    cand = tmp_path / "skill_candidates"
    cand.mkdir()
    (cand / "excel-export.md").write_text("---\nname: excel-export\n---\nsame", encoding="utf-8")
    (cand / "export-excel.md").write_text("---\nname: export-excel\n---\nsame", encoding="utf-8")
    curator._merge_near_dup_candidates(tmp_path)
    remaining = list(cand.glob("*.md"))
    assert len(remaining) == 1
    assert remaining[0].stem == "excel-export"  # 字典序更小


def test_merge_near_dup_candidates_never_touches_skills_dir(tmp_path):
    """skills/ 正式目录绝对不被碰。"""
    skills_dir = tmp_path / "skills"
    skills_dir.mkdir()
    (skills_dir / "excel-export.md").write_text("formal skill", encoding="utf-8")
    (skills_dir / "export-excel.md").write_text("formal skill 2", encoding="utf-8")

    cand = tmp_path / "skill_candidates"
    cand.mkdir()
    (cand / "data-viz.md").write_text("---\nname: data-viz\n---\nA", encoding="utf-8")

    curator._merge_near_dup_candidates(tmp_path)

    # skills/ 下文件完全不变
    assert (skills_dir / "excel-export.md").exists()
    assert (skills_dir / "export-excel.md").exists()


def test_merge_near_dup_ratio_threshold(tmp_path):
    """ratio >= 0.85 (e.g. email-send / email-sender) 合并；ratio 低的不合并。"""
    cand = tmp_path / "skill_candidates"
    cand.mkdir()
    # email-send vs email-sender: ratio高(≥0.85)
    (cand / "email-send.md").write_text("---\nname: email-send\n---\nA", encoding="utf-8")
    (cand / "email-sender.md").write_text("---\nname: email-sender\n---\nBB longer", encoding="utf-8")
    # pdf-merge: 与以上无近似
    (cand / "pdf-merge.md").write_text("---\nname: pdf-merge\n---\nC", encoding="utf-8")
    curator._merge_near_dup_candidates(tmp_path)
    remaining = sorted(p.name for p in cand.glob("*.md"))
    assert len(remaining) == 2 and "pdf-merge.md" in remaining


# ---------------------------------------------------------------------------
# B-4: employee_archive_suggestion（只建议不自动归档）
# ---------------------------------------------------------------------------

def test_employee_archive_suggestion_active_recently(db_session, workspace):
    """最近派发过任务（今天）→ suggestion 应为 None。"""
    from tests.conftest import add_employee
    from src.models.task_execution_log import TaskExecutionLog
    from src.models.workspace import CST

    emp = add_employee(db_session, workspace.id, name="active-emp")
    now_cst = datetime.now(CST)

    log = TaskExecutionLog(
        workspace_id=workspace.id,
        employee_id=emp.id,
        task_name_snapshot="fresh task",
        run_status="success",
        started_at=now_cst,
        created_at=now_cst,
    )
    db_session.add(log)
    db_session.commit()

    result = curator.employee_archive_suggestion(db_session, emp.id)
    assert result is None


def test_employee_archive_suggestion_idle_100_days(db_session, workspace):
    """最后一次派发距今 100 天 → 返回 suggestion，idle_days >= 100。"""
    from tests.conftest import add_employee
    from src.models.task_execution_log import TaskExecutionLog
    from src.models.workspace import CST

    emp = add_employee(db_session, workspace.id, name="idle-emp")
    now_cst = datetime.now(CST)
    old_time = now_cst - timedelta(days=100)

    log = TaskExecutionLog(
        workspace_id=workspace.id,
        employee_id=emp.id,
        task_name_snapshot="old task",
        run_status="success",
        started_at=old_time,
        created_at=old_time,
    )
    db_session.add(log)
    db_session.commit()

    result = curator.employee_archive_suggestion(db_session, emp.id)
    assert result is not None
    assert result["employee_id"] == emp.id
    assert result["idle_days"] >= 100
    assert result["last_active"] is not None  # ISO 字符串


def test_employee_archive_suggestion_never_dispatched_old_employee(db_session, workspace):
    """从未派发过任务、但员工创建已超 90 天 → 返回 suggestion（last_active=None）。"""
    from tests.conftest import add_employee
    from src.models.workspace import CST
    from src.models.employee import Employee

    emp = add_employee(db_session, workspace.id, name="old-never-dispatched")
    # 回写 created_at 为 100 天前（绕过 ORM default）
    old_time = datetime.now(CST) - timedelta(days=100)
    db_session.execute(
        __import__("sqlalchemy").update(Employee)
        .where(Employee.id == emp.id)
        .values(created_at=old_time)
    )
    db_session.commit()

    result = curator.employee_archive_suggestion(db_session, emp.id)
    assert result is not None
    assert result["employee_id"] == emp.id
    assert result["last_active"] is None
    assert result["idle_days"] >= 100


def test_employee_archive_suggestion_never_dispatched_new_employee(db_session, workspace):
    """从未派发过任务、且员工刚创建（today）→ None。"""
    from tests.conftest import add_employee

    emp = add_employee(db_session, workspace.id, name="new-never-dispatched")
    # created_at 默认为 cst_now()，即今天，不超过 90 天
    result = curator.employee_archive_suggestion(db_session, emp.id)
    assert result is None


def test_employee_archive_suggestion_read_only(db_session, workspace):
    """employee_archive_suggestion 纯只读：调用后员工记录不变。"""
    from tests.conftest import add_employee
    from src.models.employee import Employee
    from src.models.task_execution_log import TaskExecutionLog
    from src.models.workspace import CST

    emp = add_employee(db_session, workspace.id, name="readonly-check")
    now_cst = datetime.now(CST)
    old_time = now_cst - timedelta(days=120)

    log = TaskExecutionLog(
        workspace_id=workspace.id,
        employee_id=emp.id,
        task_name_snapshot="old task",
        run_status="success",
        started_at=old_time,
        created_at=old_time,
    )
    db_session.add(log)
    db_session.commit()

    before_status = emp.name  # 员工 name 作为状态代理（归档会改 status）

    curator.employee_archive_suggestion(db_session, emp.id)

    db_session.refresh(emp)
    assert emp.name == before_status  # 未被修改


def test_growth_brain_includes_archive_suggestion(db_session, workspace, tmp_path, monkeypatch):
    """build_employee_growth_brain 在员工长期闲置时应在 payload 中返回 archive_suggestion。"""
    from tests.conftest import add_employee
    from src.service import employee_service as es
    from src.models.task_execution_log import TaskExecutionLog
    from src.models.workspace import CST
    from src.models.employee import Employee

    emp = add_employee(db_session, workspace.id, name="growth-brain-archive")
    brain_dir = tmp_path / str(emp.id)
    brain_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(es, "_growth_brain_root_for", lambda eid: brain_dir)

    # 回写 created_at 为 100 天前
    old_time = datetime.now(CST) - timedelta(days=100)
    db_session.execute(
        __import__("sqlalchemy").update(Employee)
        .where(Employee.id == emp.id)
        .values(created_at=old_time)
    )
    db_session.commit()

    result = es.EmployeeService.build_employee_growth_brain(db_session, emp.id)
    assert "archive_suggestion" in result
    sugg = result["archive_suggestion"]
    assert sugg is not None
    assert sugg["employee_id"] == emp.id
    assert sugg["idle_days"] >= 100


def test_growth_brain_archive_suggestion_none_for_active(db_session, workspace, tmp_path, monkeypatch):
    """build_employee_growth_brain：最近活跃员工 archive_suggestion 应为 None。"""
    from tests.conftest import add_employee
    from src.service import employee_service as es
    from src.models.task_execution_log import TaskExecutionLog
    from src.models.workspace import CST

    emp = add_employee(db_session, workspace.id, name="growth-brain-active")
    brain_dir = tmp_path / str(emp.id)
    brain_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(es, "_growth_brain_root_for", lambda eid: brain_dir)

    now_cst = datetime.now(CST)
    log = TaskExecutionLog(
        workspace_id=workspace.id,
        employee_id=emp.id,
        task_name_snapshot="recent task",
        run_status="success",
        started_at=now_cst,
        created_at=now_cst,
    )
    db_session.add(log)
    db_session.commit()

    result = es.EmployeeService.build_employee_growth_brain(db_session, emp.id)
    assert result["archive_suggestion"] is None
