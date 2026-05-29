"""employee_generation_service._parse_skill_profiles count 对齐。"""

from __future__ import annotations

from src.schemas.employee import EmployeeProfile
from src.service.employee_generation_service import EmployeeGenerationService


def test_parse_skill_profiles_pads_when_fewer_than_count():
    raw = '[{"name":"数据分析师","description":"分析数据","skill_ids":[]}]'
    profiles = EmployeeGenerationService._parse_skill_profiles(raw, [], count=3)

    assert len(profiles) == 3
    assert profiles[0].name == "数据分析师"
    assert profiles[1].name == "候选员工 2"
    assert profiles[2].name == "候选员工 3"


def test_parse_skill_profiles_truncates_when_more_than_count():
    raw = """[
        {"name":"员工甲","description":"d1","skill_ids":[]},
        {"name":"员工乙","description":"d2","skill_ids":[]},
        {"name":"员工丙","description":"d3","skill_ids":[]}
    ]"""
    profiles = EmployeeGenerationService._parse_skill_profiles(raw, [], count=2)

    assert len(profiles) == 2
    assert profiles[0].name == "员工甲"
    assert profiles[1].name == "员工乙"


def test_normalize_profile_count_noop_when_exact():
    profiles = [
        EmployeeProfile(name="A", description="d", skill_ids=[], skills_list=[]),
        EmployeeProfile(name="B", description="d", skill_ids=[], skills_list=[]),
    ]
    result = EmployeeGenerationService._normalize_profile_count(profiles, 2)
    assert len(result) == 2
    assert result[0].name == "A"
    assert result[1].name == "B"
