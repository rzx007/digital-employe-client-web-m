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
