def test_ensure_curator_conversation_is_user_scoped(db_session):
    from src.models.workspace import Workspace
    from src.models.conversation import Conversation
    from src.service.chat_service import ChatService
    ws = Workspace(name="w", root_path="/tmp/w", user_id="u1"); db_session.add(ws); db_session.commit()
    read = ChatService.ensure_curator_conversation(db_session, "u1", ws.id)
    conv = db_session.get(Conversation, read.id)
    assert conv.user_id == "u1"
    assert conv.workspace_id == ws.id
    assert conv.target_type == "curator"
    # idempotent: same user+workspace returns the same conversation
    read2 = ChatService.ensure_curator_conversation(db_session, "u1", ws.id)
    assert read2.id == read.id


def test_delete_employee_rejects_other_users_employee(db_session):
    from src.models.employee import Employee
    from src.service.agent.orchestrator.employee_mutations import _delete_employee_in_session
    emp = Employee(workspace_id=1, user_id="owner", employee_code="e1", name="E1")
    db_session.add(emp); db_session.commit()
    # current user "intruder" must NOT be able to delete "owner"'s employee
    res = _delete_employee_in_session(db_session, "intruder", 1, emp.id)
    assert res.get("error")
    assert db_session.get(Employee, emp.id) is not None  # not deleted
    # the real owner can
    res2 = _delete_employee_in_session(db_session, "owner", 1, emp.id)
    assert res2.get("employee_name") == "E1"
