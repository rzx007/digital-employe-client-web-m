from src.service.employee_service import _BUILTIN_SEED_EMPLOYEES


def test_bug_reporter_employee_seeded():
    by_name = {name: skills for name, skills, _ in _BUILTIN_SEED_EMPLOYEES}
    assert "问题反馈助手" in by_name
    assert by_name["问题反馈助手"] == ("bug-reporter",)
