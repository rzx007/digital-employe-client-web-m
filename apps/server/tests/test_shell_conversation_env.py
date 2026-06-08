from src.service.skill_shell_backend import SkillAwareShellBackend


def _mk(tmp_path, conversation_id):
    return SkillAwareShellBackend(
        root_dir=str(tmp_path),
        skills_root=tmp_path,
        draft_root=None,
        conversation_id=conversation_id,
    )


def test_conversation_id_injected_into_env(tmp_path):
    be = _mk(tmp_path, 42)
    assert be._env.get("CONVERSATION_ID") == "42"


def test_no_conversation_id_means_no_env(tmp_path):
    be = _mk(tmp_path, None)
    assert "CONVERSATION_ID" not in be._env
