from src.service.agent.update_skill_tool import create_update_skill_tool


def test_rejects_skill_not_loaded():
    tool = create_update_skill_tool(employee_id=1, available_skills=["pptx", "xlsx"])
    out = tool.invoke({"skill_name": "not-loaded", "new_content": "x", "reason": "r"})
    assert "拒绝" in out and "not-loaded" in out


def test_applies_update_and_syncs(monkeypatch):
    calls = {}

    class _Emp:
        workspace_id = 7
        user_id = "u1"

    class _DB:
        def get(self, *_): return _Emp()
        def commit(self): calls["commit"] = True
        def rollback(self): calls["rollback"] = True
        def close(self): calls["close"] = True

    monkeypatch.setattr(
        "src.db.session.get_session_local", lambda: (lambda: _DB())
    )
    monkeypatch.setattr(
        "src.service.local_skill_service.LocalSkillService.update_local_skill",
        lambda name, ws, **kw: calls.setdefault("update", (name, ws, kw)),
    )
    monkeypatch.setattr(
        "src.service.employee_service.EmployeeService.sync_local_skill_to_assignees",
        lambda db, **kw: calls.setdefault("sync", kw),
    )
    monkeypatch.setattr(
        "src.service.local_skill_service.LocalSkillService.ensure_editable_from_employee_copy",
        lambda name, ws, emp: None,
    )
    tool = create_update_skill_tool(employee_id=1, available_skills=["pptx"])
    out = tool.invoke({"skill_name": "pptx", "new_content": "NEW", "reason": "缺步骤"})

    assert "已更新" in out
    assert calls["update"][0] == "pptx" and calls["update"][1] == 7
    assert calls["update"][2]["skill_md_content"] == "NEW"
    assert calls["update"][2]["target"] == "workspace"   # 防就地改全局内置
    assert calls["sync"] == {"user_id": "u1", "workspace_id": 7, "skill_name": "pptx"}
    assert calls.get("commit") and calls.get("close")
    assert "rollback" not in calls


def test_rejects_null_user_id(monkeypatch):
    class _EmpNoUser:
        workspace_id = 7
        user_id = None

    class _DB:
        def get(self, *_): return _EmpNoUser()
        def commit(self): ...
        def rollback(self): ...
        def close(self): ...

    monkeypatch.setattr("src.db.session.get_session_local", lambda: (lambda: _DB()))
    tool = create_update_skill_tool(employee_id=99, available_skills=["pptx"])
    out = tool.invoke({"skill_name": "pptx", "new_content": "X", "reason": "r"})
    assert "拒绝" in out and "user_id" in out


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
