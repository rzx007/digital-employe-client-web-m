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


def test_employee_prompt_has_rhythmic_wait_guidance():
    # build_system_prompt 拼装后的员工系统提示应含 shell 节奏指引。
    # 用 inspect.getsource 抓常量文本而非渲染，避免依赖参数：节奏指引是常量文本片段。
    import inspect
    import src.service.agent.prompts as prompts_mod
    src = inspect.getsource(prompts_mod)
    assert "shell_wait" in src
    assert "有节奏" in src
    assert "稍后问我进度" in src


def test_orchestrator_prompt_has_start_service_guidance():
    from src.service.agent.orchestrator.prompts import (
        ORCHESTRATOR_SYSTEM_PROMPT_TEMPLATE,
    )
    assert "start_service" in ORCHESTRATOR_SYSTEM_PROMPT_TEMPLATE


def test_employee_prompt_has_start_service_guidance():
    import inspect
    import src.service.agent.prompts as prompts_mod
    assert "start_service" in inspect.getsource(prompts_mod)


def test_orchestrator_prompt_mentions_watch_background():
    from src.service.agent.orchestrator.prompts import (
        ORCHESTRATOR_SYSTEM_PROMPT_TEMPLATE,
    )
    assert "watch_background" in ORCHESTRATOR_SYSTEM_PROMPT_TEMPLATE


def test_employee_prompt_mentions_watch_background():
    import inspect
    import src.service.agent.prompts as prompts_mod
    assert "watch_background" in inspect.getsource(prompts_mod)
