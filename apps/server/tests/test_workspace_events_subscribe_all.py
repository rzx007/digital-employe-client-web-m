import json
from src.service.workspace_events import WorkspaceEventBus, PLAN_RUN_SETTLED


def test_subscribe_all_receives_event_for_unsubscribed_workspace():
    q = WorkspaceEventBus.subscribe_all()
    # workspace 9999 从未被 subscribe()
    WorkspaceEventBus.push(9999, {"type": PLAN_RUN_SETTLED, "run_id": 1, "workspace_id": 9999})
    evt = json.loads(q.get_nowait())
    assert evt["type"] == PLAN_RUN_SETTLED and evt["workspace_id"] == 9999
