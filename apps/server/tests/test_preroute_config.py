def test_settings_has_agent_skill_preroute_default_true():
    from dataclasses import fields
    from src.core.config import Settings

    f = {x.name: x for x in fields(Settings)}
    assert "agent_skill_preroute" in f
    assert f["agent_skill_preroute"].default is True
