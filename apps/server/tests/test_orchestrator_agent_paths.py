"""orchestrator agent：backend 不再是 CompositeBackend 虚拟路由；技能可写。"""
import inspect

from src.service.agent.orchestrator import agent as orch


def test_orch_no_composite_routes():
    src = inspect.getsource(orch.get_orchestrator_agent)
    assert "CompositeBackend" not in src
    assert '"/skills/"' not in src
    assert '"/artifacts/"' not in src


def test_orch_skills_memory_real_paths():
    src = inspect.getsource(orch.get_orchestrator_agent)
    assert 'memory=["/agent/AGENTS.md"' not in src
    assert 'skills=["/skills/"]' not in src


def test_orch_uses_workspace_dirs_owner_orchestrator():
    src = inspect.getsource(orch.get_orchestrator_agent)
    assert "resolve_workspace_dirs(" in src
    assert 'employee_id="orchestrator"' in src
    assert "workspace_root=ws.workspace_dir" in src
    assert "public_dir=ws.public_dir" in src


def test_no_orchestrator_desk_plumbing_in_source():
    """共享桌已消解：总管 agent 源码不再注入 desk / shared_* override。"""
    src = inspect.getsource(orch.get_orchestrator_agent)
    assert "resolve_orchestrator_desk_dir" not in src
    assert "shared_artifacts_dir" not in src
    assert "shared_workspace_root" not in src


def test_team_is_colocated_without_desk(db_session):
    """共享桌消解的前提验证：同一项目下总管会话与被派员工会话解析到
    同一个产物根 → 同一个 <root>/artifacts 桶，全队天然同写同读，无需桌。"""
    from src.models.workspace import Workspace
    from src.models.conversation import Conversation
    from src.service.product_paths import resolve_conversation_product_root

    ws = Workspace(name="proj", root_path="/tmp/proj-colocate", user_id="u1")
    db_session.add(ws)
    db_session.flush()

    orch_conv = Conversation(
        workspace_id=ws.id, user_id="u1", target_type="curator", target_id=1
    )
    emp_conv = Conversation(
        workspace_id=ws.id, user_id="u1", target_type="employee", target_id=7
    )
    db_session.add_all([orch_conv, emp_conv])
    db_session.commit()

    orch_root = resolve_conversation_product_root(db_session, orch_conv)
    emp_root = resolve_conversation_product_root(db_session, emp_conv)

    # 同项目 → 同产物根 → 同 artifacts 桶（无桌即可互见产物）
    assert orch_root == emp_root
    assert orch_root / "artifacts" == emp_root / "artifacts"
