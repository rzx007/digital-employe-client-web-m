"""总管助手工具集。

按职能域拆分为 4 个子模块（与三大类对应）：

- **employees** 员工管理：list_workspace_employees、get_employee、
  update_employee、delete_employee、recruit_employee、hire_employee、
  hire_employees
- **plans** 编排计划：create_orchestration_plan、confirm_orchestration_plan、
  cancel_plan
- **tasks** 子任务管理：list_tasks、update_task、delete_task、delete_tasks_batch、redispatch_task
- **skills** 技能管理：list_workspace_skills、get_workspace_skill_detail、
  delete_workspace_skill、delete_workspace_skills_batch、list_builtin_skills、
  install_builtin_skill、search_market_skills、get_market_skill_detail、
  install_market_skill

`from src.service.agent.orchestrator.tools import xxx` 仍可用，详见各子模块 re-export。
"""

from __future__ import annotations

from src.service.agent.orchestrator.tools._helpers import (
    MARKET_SKILL_DETAIL_MAX,
    MARKET_SKILL_SEARCH_LIMIT,
    SKILL_MARKET_URL,
    parse_orchestration_task_list,
    reset_market_detail_count,
    resolve_conv_id,
    take_market_detail_slot,
)
from src.service.agent.orchestrator.tools.employees import (
    build_employee_update_payload,
    delete_employee,
    delete_employees_batch,
    get_employee,
    hire_employee,
    hire_employees,
    list_workspace_employees,
    recruit_employee,
    update_employee,
)
from src.service.agent.orchestrator.tools.plans import (
    cancel_plan,
    confirm_orchestration_plan,
    create_orchestration_plan,
)
from src.service.agent.orchestrator.tools.skills import (
    delete_workspace_skill,
    delete_workspace_skills_batch,
    format_workspace_skills_list,
    get_market_skill_detail,
    get_workspace_skill_detail,
    install_builtin_skill,
    install_market_skill,
    list_builtin_skills,
    list_workspace_skills,
    search_market_skills,
)
from src.service.agent.orchestrator.tools.tasks import (
    delete_task,
    delete_tasks_batch,
    list_tasks,
    redispatch_task,
    update_task,
)
from src.service.agent.orchestrator.tools.workbench import (
    add_workbench_widget,
    update_workbench_widget,
    list_workbench_widgets,
)

__all__ = [
    # employees
    "list_workspace_employees",
    "get_employee",
    "update_employee",
    "delete_employee",
    "delete_employees_batch",
    "recruit_employee",
    "hire_employee",
    "hire_employees",
    "build_employee_update_payload",
    # plans
    "create_orchestration_plan",
    "confirm_orchestration_plan",
    "cancel_plan",
    # tasks
    "list_tasks",
    "update_task",
    "delete_task",
    "delete_tasks_batch",
    "redispatch_task",
    # skills
    "list_workspace_skills",
    "get_workspace_skill_detail",
    "delete_workspace_skill",
    "delete_workspace_skills_batch",
    "list_builtin_skills",
    "install_builtin_skill",
    "search_market_skills",
    "get_market_skill_detail",
    "install_market_skill",
    "format_workspace_skills_list",
    # workbench
    "add_workbench_widget",
    "update_workbench_widget",
    "list_workbench_widgets",
    # shared helpers
    "parse_orchestration_task_list",
    "resolve_conv_id",
    "reset_market_detail_count",
    "take_market_detail_slot",
    "SKILL_MARKET_URL",
    "MARKET_SKILL_SEARCH_LIMIT",
    "MARKET_SKILL_DETAIL_MAX",
]
