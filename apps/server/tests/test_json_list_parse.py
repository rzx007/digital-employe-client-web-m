from __future__ import annotations

from src.service.agent.orchestrator.json_list_parse import parse_json_int_list


def test_parse_json_int_list_from_string():
    parsed, err = parse_json_int_list("[-100, 11]", "skill_ids")
    assert err is None
    assert parsed == [-100, 11]


def test_parse_json_int_list_from_python_list():
    parsed, err = parse_json_int_list([-100, 11], "skill_ids")
    assert err is None
    assert parsed == [-100, 11]


def test_parse_json_int_list_from_single_int():
    parsed, err = parse_json_int_list(-100, "skill_ids")
    assert err is None
    assert parsed == [-100]


def test_parse_json_int_list_rejects_scalar_string():
    parsed, err = parse_json_int_list("-100", "skill_ids")
    assert parsed == [-100]
    assert err is None
