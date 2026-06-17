from __future__ import annotations


def test_list_user_conversations_across_workspaces(db_session):
    from src.models.conversation import Conversation
    from src.service.chat_service import ChatService

    # u1 has convs in two workspaces (curator + employee); u2 has one — must not leak
    db_session.add_all([
        Conversation(workspace_id=1, user_id="u1", target_type="curator", target_id=1, title="c1"),
        Conversation(workspace_id=2, user_id="u1", target_type="employee", target_id=5, title="e1"),
        Conversation(workspace_id=1, user_id="u2", target_type="curator", target_id=1, title="c2"),
    ])
    db_session.commit()
    allc = ChatService.list_user_conversations(db_session, "u1")
    titles = {c.title for c in allc}
    assert titles == {"c1", "e1"}
    only_curator = ChatService.list_user_conversations(db_session, "u1", "curator")
    assert {c.title for c in only_curator} == {"c1"}


def test_create_conversation_sets_user_id_from_workspace_owner(db_session):
    from src.models.workspace import Workspace
    from src.models.employee import Employee
    from src.service.chat_service import ChatService

    ws = Workspace(name="w", root_path="/tmp/w", user_id="u7")
    db_session.add(ws)
    db_session.flush()
    emp = Employee(workspace_id=ws.id, user_id="u7", employee_code="e", name="E")
    db_session.add(emp)
    db_session.commit()
    conv = ChatService.create_conversation(db_session, ws.id, "employee", emp.id, None)
    assert conv.user_id == "u7"
