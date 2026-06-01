"""tools.employees / tools.skills：员工 CRUD、payload 与工作区技能库 listing、Session 失效。"""

from __future__ import annotations

import json

from src.models.employee import Employee
from src.models.employee_skill import EmployeeSkill
from src.service.agent.orchestrator.tools.employees import (
    build_employee_update_payload,
    delete_employee,
    get_employee,
    update_employee,
)
from src.service.agent.orchestrator.tools.skills import (
    format_workspace_skills_list,
    get_workspace_skill_detail,
    list_workspace_skills,
)
from src.service.agent.orchestrator.runtime import set_context
from tests.conftest import add_employee


def test_build_payload_skill_ids_only_excludes_name():
    payload = build_employee_update_payload(skill_ids=[])

    assert "employee_name" not in payload.model_fields_set
    assert "capability_desc" not in payload.model_fields_set
    assert payload.skill_ids == []


def test_build_payload_includes_only_provided_fields():
    payload = build_employee_update_payload(
        employee_name="  法务助手  ",
        capability_desc="负责合同审查",
    )

    assert payload.employee_name == "法务助手"
    assert payload.capability_desc == "负责合同审查"
    assert "skill_ids" not in payload.model_fields_set


def test_format_workspace_skills_list_empty(monkeypatch):
    monkeypatch.setattr(
        "src.service.agent.orchestrator.tools.skills.LocalSkillService.list_local_skills",
        lambda workspace_id: [],
    )
    assert format_workspace_skills_list(1) == []


def test_format_workspace_skills_list_maps_local_id(monkeypatch):
    monkeypatch.setattr(
        "src.service.agent.orchestrator.tools.skills.LocalSkillService.list_local_skills",
        lambda workspace_id: [
            {
                "localId": -101,
                "skillName": "sql-query",
                "displayNameZh": "SQL查询",
                "description": "数据库查询分析技能",
                "isBuiltin": True,
            }
        ],
    )
    skills = format_workspace_skills_list(1)
    assert len(skills) == 1
    assert skills[0]["id"] == -101
    assert skills[0]["display_name_zh"] == "SQL查询"


def test_list_workspace_skills_tool_returns_json(db_session, workspace, monkeypatch):
    monkeypatch.setattr(
        "src.service.agent.orchestrator.tools.skills.LocalSkillService.list_local_skills",
        lambda workspace_id: [
            {
                "localId": -102,
                "skillName": "doc-writer",
                "displayNameZh": "文档写作",
                "description": "撰写文档",
                "isBuiltin": False,
            }
        ],
    )
    set_context(db=db_session, workspace_id=workspace.id, conversation_id=1)

    result = list_workspace_skills.invoke({})
    payload = json.loads(result)

    assert payload["type"] == "workspace_skills"
    assert payload["total"] == 1
    assert payload["skills"][0]["id"] == -102


def test_get_workspace_skill_detail_by_local_id(db_session, workspace, monkeypatch):
    monkeypatch.setattr(
        "src.service.agent.orchestrator.tools.skills.LocalSkillService.list_local_skills",
        lambda workspace_id: [
            {
                "localId": -103,
                "skillName": "data-querys",
                "displayNameZh": "交易日历",
                "isBuiltin": False,
            }
        ],
    )
    monkeypatch.setattr(
        "src.service.agent.orchestrator.tools.skills.LocalSkillService.get_local_skill_detail",
        lambda skill_name, workspace_id: {
            "skillName": skill_name,
            "localId": -103,
            "displayNameZh": "交易日历",
            "isBuiltin": False,
            "files": ["SKILL.md", "scripts/run.py"],
            "skillMdContent": "# 获取交易日历\n\n用法说明",
        },
    )
    set_context(db=db_session, workspace_id=workspace.id, conversation_id=1)

    result = get_workspace_skill_detail.invoke({"local_id": -103})

    assert "data-querys" in result
    assert "localId: -103" in result
    assert "获取交易日历" in result
    assert "分配情况" in result
    assert "禁止用 read_file" in result


def test_get_workspace_skill_detail_shows_assignees(
    db_session, workspace, monkeypatch
):
    employee = add_employee(db_session, workspace.id, name="飞书助手")
    db_session.add(
        EmployeeSkill(
            workspace_id=workspace.id,
            employee_id=employee.id,
            skill_id=-103,
            skill_name="data-querys",
            skill_name_zh="交易日历",
        )
    )
    db_session.commit()

    monkeypatch.setattr(
        "src.service.agent.orchestrator.tools.skills.LocalSkillService.get_local_skill_detail",
        lambda skill_name, workspace_id: {
            "skillName": skill_name,
            "localId": -103,
            "displayNameZh": "交易日历",
            "isBuiltin": False,
            "files": ["SKILL.md"],
            "skillMdContent": "# 获取交易日历",
        },
    )
    set_context(db=db_session, workspace_id=workspace.id, conversation_id=1)

    result = get_workspace_skill_detail.invoke({"skill_name": "data-querys"})

    assert "飞书助手" in result
    assert "employee_id=" in result
    assert "尚未分配给任何员工" not in result


def test_get_employee_tool_returns_json(db_session, workspace):
    employee = add_employee(db_session, workspace.id, name="数据分析师")
    set_context(db=db_session, workspace_id=workspace.id, conversation_id=1)

    result = get_employee.invoke({"employee_id": employee.id})
    payload = json.loads(result)

    assert payload["type"] == "employee_detail"
    assert payload["employee_id"] == employee.id
    assert payload["employee_name"] == "数据分析师"


def test_update_employee_tool_accepts_skill_ids_list(
    db_session, workspace, patched_employee_tools_db, monkeypatch
):
    employee = add_employee(db_session, workspace.id, name="技能测试员")
    monkeypatch.setattr(
        "src.service.employee_service.EmployeeService._resolve_skills_for_assignment",
        lambda skill_ids, workspace_id, token: (
            [{"id": 11, "skillName": "remote-skill", "displayNameZh": "远程", "source": "remote"}],
            [{"id": -100, "skillName": "feishu-workbench", "displayNameZh": "工作台", "source": "local", "path": "/tmp/x"}],
        ),
    )
    set_context(db=db_session, workspace_id=workspace.id, conversation_id=1)

    result = update_employee.invoke(
        {"employee_id": employee.id, "skill_ids": [-100, 11]}
    )
    payload = json.loads(result)

    assert payload["type"] == "employee_updated"


def test_update_employee_tool_refreshes_shared_session(
    db_session, workspace, patched_employee_tools_db
):
    employee = add_employee(db_session, workspace.id, name="旧名称")
    db_session.get(Employee, employee.id)

    set_context(db=db_session, workspace_id=workspace.id, conversation_id=1)
    result = update_employee.invoke(
        {"employee_id": employee.id, "employee_name": "新名称"}
    )
    payload = json.loads(result)

    assert payload["type"] == "employee_updated"
    assert payload["employee_name"] == "新名称"
    detail = json.loads(get_employee.invoke({"employee_id": employee.id}))
    assert detail["employee_name"] == "新名称"


def test_delete_employee_rejects_curator(
    db_session, workspace, patched_employee_tools_db
):
    curator = add_employee(
        db_session, workspace.id, name="总管助手", is_curator=True
    )
    set_context(db=db_session, workspace_id=workspace.id, conversation_id=1)

    result = delete_employee.invoke({"employee_id": curator.id})

    assert result == "错误：不能删除总管助手。"
