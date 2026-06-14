"""总管自身技能加载：固定 orchestrator_skills 之外叠加工作区本地技能库。

根因回归：总管原先 skills=[orchestrator_skills] 写死，能给员工装/分配技能却唯独
自己加载不到工作区技能。此测试验证 get_orchestrator_agent 会把
local-skills/<workspace_id> 叠加进 deepagents 的 skills 源列表，并把这些技能名
注入「可用技能」清单（系统提示）。
"""
from __future__ import annotations

import json

import pytest

from src.service.agent.orchestrator import agent as orch


def _seed_workspace_skill(local_skills_root, workspace_id: int, name: str) -> str:
    """在 local-skills/<workspace_id>/<name>/ 下写一个最小可被发现的技能。"""
    skill_dir = local_skills_root / str(workspace_id) / name
    skill_dir.mkdir(parents=True, exist_ok=True)
    (skill_dir / "SKILL.md").write_text(
        f"---\nname: {name}\ndescription: test skill\n---\n# {name}\n",
        encoding="utf-8",
    )
    return name


@pytest.fixture
def _capture_skills(monkeypatch, tmp_path):
    """截获 create_deep_agent 的 skills 参数，并把技能/产物根指到 tmp。"""
    captured: dict = {}

    def _fake_create_deep_agent(*args, **kwargs):
        captured["skills"] = list(kwargs.get("skills") or [])
        captured["system_prompt"] = kwargs.get("system_prompt") or ""
        return object()  # 不需要真实 agent

    monkeypatch.setattr(orch, "create_deep_agent", _fake_create_deep_agent)
    # 避免真正建模型 / 起 checkpointer
    monkeypatch.setattr(orch, "build_chat_model", lambda **_: object())
    monkeypatch.setattr(orch, "resolve_output_tokens", lambda *_: None)
    monkeypatch.setattr(orch, "get_checkpointer", lambda: None)
    monkeypatch.setattr(
        orch, "build_summarization_middleware_stack", lambda **_: (None, None)
    )

    local_skills_root = tmp_path / "local-skills"
    artifacts_root = tmp_path / "artifacts"
    local_skills_root.mkdir(parents=True, exist_ok=True)
    artifacts_root.mkdir(parents=True, exist_ok=True)

    settings = orch.get_settings()
    monkeypatch.setattr(settings, "local_skills_path", str(local_skills_root))
    monkeypatch.setattr(settings, "artifacts_path", str(artifacts_root))

    return captured, local_skills_root


def test_orchestrator_loads_workspace_skill_library(_capture_skills):
    captured, local_skills_root = _capture_skills
    workspace_id = 4242
    _seed_workspace_skill(local_skills_root, workspace_id, "data-querys")

    orch.get_orchestrator_agent(
        workspace_id=workspace_id,
        db=None,
        conversation_id=None,
        bind_context=False,
        enable_hitl=False,
    )

    skills = captured["skills"]
    # 工作区技能库目录被叠加为一个技能源
    ws_root = str(local_skills_root / str(workspace_id))
    assert any(ws_root == s or s.startswith(ws_root) for s in skills), skills
    # 原固定 orchestrator_skills 仍在（保留并叠加，不替换）
    assert any("orchestrator_skills" in s for s in skills), skills
    # 工作区技能名进入「可用技能」清单（注入系统提示）
    assert "data-querys" in captured["system_prompt"]


def test_orchestrator_self_skills_no_crash_when_empty(_capture_skills):
    """工作区无任何本地技能时不报错，仍至少保留固定技能源。"""
    captured, _ = _capture_skills

    orch.get_orchestrator_agent(
        workspace_id=999,
        db=None,
        conversation_id=None,
        bind_context=False,
        enable_hitl=False,
    )

    skills = captured["skills"]
    assert any("orchestrator_skills" in s for s in skills), skills
