"""Live agent 适配器：把一个用例跑成 AgentResult。

⚠️ 这是评估集里**唯一依赖真实模型端点 + DB** 的部分，需在配好 llama.cpp 端点的
环境里联调验证。其余模块（checks/judge/run.extract_agent_result）均纯函数、已离线单测。

做的事：
1. 建临时 file-sqlite，create_all，按 case.setup 预置 workspace / employees / skills / tasks；
2. employee 链路 → get_agent(...)；orchestrator 链路 → get_orchestrator_agent(...)；
3. ainvoke 编译后的 agent 图，单轮输入；
4. 用 run.extract_agent_result 解析终态。
"""

from __future__ import annotations

import tempfile
import uuid
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from src import models  # noqa: F401  确保所有表注册
from src.db.base import Base
from src.models.employee import Employee
from src.models.employee_skill import EmployeeSkill
from src.models.employee_task import EmployeeTask
from src.models.workspace import Workspace


def _seed(db, workspace_id: int, setup: dict) -> dict[str, int]:
    """按 setup 预置员工/技能/定时任务，返回 {员工名: id}。"""
    name_to_id: dict[str, int] = {}
    for spec in (setup or {}).get("employees", []) or []:
        emp = Employee(
            workspace_id=workspace_id,
            employee_code=f"code-{spec['name']}",
            name=spec["name"],
            description=spec.get("description", "评估用员工"),
            is_curator=spec.get("is_curator", False),
        )
        db.add(emp)
        db.commit()
        db.refresh(emp)
        name_to_id[emp.name] = emp.id
        for skill in spec.get("skills", []) or []:
            db.add(
                EmployeeSkill(
                    employee_id=emp.id,
                    skill_name=skill,
                    skill_name_zh=skill,
                    skill_description="评估用技能",
                )
            )
        for task_name in spec.get("tasks", []) or []:
            db.add(
                EmployeeTask(
                    workspace_id=workspace_id,
                    employee_id=emp.id,
                    employee_name_snapshot=emp.name,
                    task_name=task_name,
                    dispatch_type="skill",
                    cron_expression="0 9 * * *",
                    cron_expression_type="custom",
                    user_prompt="评估用定时任务",
                    execute_mode="scheduled",
                    source="manual",
                    is_active=True,
                )
            )
        db.commit()
    return name_to_id


async def invoke_agent(case: dict):
    """跑一个用例，返回 AgentResult。"""
    from evals.run import extract_agent_result  # 避免循环导入

    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    db = Session()
    workspace_root = tempfile.mkdtemp(prefix="de-eval-ws-")
    try:
        ws = Workspace(id=1, name="Eval WS", root_path=workspace_root)
        db.add(ws)
        db.commit()
        _seed(db, ws.id, case.get("setup") or {})

        conversation_id = 1
        thread_id = f"eval-{case['id']}-{uuid.uuid4().hex[:6]}"
        user_input = case.get("input", "")

        if case.get("target") == "orchestrator":
            from src.service.agent.orchestrator import get_orchestrator_agent

            agent = get_orchestrator_agent(
                workspace_id=ws.id,
                db=db,
                conversation_id=conversation_id,
            )
        else:
            from src.service.agent.employee import get_agent

            skills_dir = Path(workspace_root) / "skills"
            skills_dir.mkdir(parents=True, exist_ok=True)
            agent = get_agent(
                str(skills_dir),
                workspace_root,
                employee_id=None,
                conversation_id=conversation_id,
            )

        config = {"configurable": {"thread_id": thread_id}}
        final_state = await agent.ainvoke(
            {"messages": [{"role": "user", "content": user_input}]},
            config=config,
        )
        return extract_agent_result(final_state)
    finally:
        db.close()
        engine.dispose()
