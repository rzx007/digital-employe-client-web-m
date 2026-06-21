"""按 OS 分支的 shell 环境 prompt。"""

from src.service.agent.path_access import prompt_rules


def test_shell_environment_section_matches_platform(monkeypatch) -> None:
    monkeypatch.setattr(prompt_rules.platform, "system", lambda: "Windows")
    assert "Windows" in prompt_rules.build_shell_environment_section()
    assert "cmd.exe" in prompt_rules.build_shell_environment_section()

    monkeypatch.setattr(prompt_rules.platform, "system", lambda: "Darwin")
    assert "macOS" in prompt_rules.build_shell_environment_section()
    assert "/Users/" in prompt_rules.build_shell_environment_section()

    monkeypatch.setattr(prompt_rules.platform, "system", lambda: "Linux")
    assert "Linux" in prompt_rules.build_shell_environment_section()
    assert "/home/" in prompt_rules.build_shell_environment_section()


def test_orchestrator_prompt_has_rhythmic_wait_guidance():
    from src.service.agent.orchestrator.prompts import (
        ORCHESTRATOR_SYSTEM_PROMPT_TEMPLATE,
    )
    p = ORCHESTRATOR_SYSTEM_PROMPT_TEMPLATE
    assert "shell_wait" in p
    assert "有节奏" in p
    assert "稍后问我进度" in p
