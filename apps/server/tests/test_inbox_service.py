from src.service.channel import inbox_service as S


def test_record_event_dedup(db_session):
    row = S.record_event(db_session, channel="feishu", external_event_id="e1",
                         external_user_id="ou", external_chat_id="oc",
                         workspace_id=1, conversation_id=2, text="hi")
    assert row is not None
    dup = S.record_event(db_session, channel="feishu", external_event_id="e1",
                         external_user_id="ou", external_chat_id="oc",
                         workspace_id=1, conversation_id=2, text="hi")
    assert dup is None  # 去重


def test_find_pending_by_conversation_latest(db_session):
    S.record_event(db_session, channel="feishu", external_event_id="e1",
                   external_user_id="ou", external_chat_id="oc",
                   workspace_id=1, conversation_id=2, text="a", status="reported")
    r2 = S.record_event(db_session, channel="feishu", external_event_id="e2",
                        external_user_id="ou", external_chat_id="oc",
                        workspace_id=1, conversation_id=2, text="b", status="acked")
    found = S.find_pending_by_conversation(db_session, 2)
    assert found.id == r2.id


def test_find_pending_by_plan_run(db_session):
    r = S.record_event(db_session, channel="feishu", external_event_id="e3",
                       external_user_id="ou", external_chat_id="oc",
                       workspace_id=1, conversation_id=9, text="c", status="running")
    S.mark(db_session, r, "running", plan_run_id=55)
    assert S.find_pending_by_plan_run(db_session, 55).id == r.id


def test_list_unsettled(db_session):
    S.record_event(db_session, channel="feishu", external_event_id="e4",
                   external_user_id="ou", external_chat_id="oc",
                   workspace_id=1, conversation_id=3, text="d", status="reported")
    S.record_event(db_session, channel="feishu", external_event_id="e5",
                   external_user_id="ou", external_chat_id="oc",
                   workspace_id=1, conversation_id=3, text="e", status="acked")
    assert len(S.list_unsettled(db_session)) == 1
