from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from langchain.tools import ToolRuntime
from langchain_core.tools import tool
from sqlalchemy import select
from fastapi import HTTPException

from src.core.runtime_capabilities import get_capabilities
from src.models.employee import Employee
from src.models.employee_task import EmployeeTask
from src.models.orchestration_plan import OrchestrationPlan
from src.service.agent.orchestrator.confirmation_policy import compute_requires_confirmation
from src.service.agent.orchestrator.execution import execute_plan
from src.service.agent.orchestrator.prompts import build_employee_capability_context
from src.service.agent.orchestrator.runtime import (
    get_conversation_id,
    get_db,
    get_workspace_id,
    invalidate_orchestrator_db_cache,
    resolve_workspace_id,
)
from src.service.agent.orchestrator.task_mutations import (
    MAX_TASK_DELETE_BATCH,
    _delete_task_with_fresh_session,
    _update_task_with_fresh_session,
    delete_tasks_batch as run_delete_tasks_batch,
)
from src.service.agent.orchestrator.task_validation import validate_orchestration_tasks
from src.service.local_skill_service import LocalSkillService
from src.service.skillsmp_service import SkillsMpError, SkillsMpService

SKILL_MARKET_URL = "https://skillsmp.com/search"


def parse_orchestration_task_list(tasks: Any) -> tuple[list[dict] | None, str | None]:
    """将 tasks 参数规范为子任务 dict 列表。支持 JSON 字符串或数组（模型常传 object）。"""
    if isinstance(tasks, list):
        task_list = tasks
    elif isinstance(tasks, str):
        try:
            parsed = json.loads(tasks)
        except json.JSONDecodeError as exc:
            return None, f"错误：tasks 参数格式不是合法的 JSON 数组: {exc}"
        if not isinstance(parsed, list):
            return None, "错误：tasks JSON 必须是数组。"
        task_list = parsed
    else:
        return None, "错误：tasks 必须是 JSON 数组字符串或数组。"

    if len(task_list) == 0:
        return None, "错误：tasks 不能为空，至少需要一个子任务。"

    normalized: list[dict] = []
    for i, item in enumerate(task_list):
        if not isinstance(item, dict):
            return None, f"错误：子任务 #{i} 必须是对象。"
        normalized.append(item)
    return normalized, None


@tool
def list_workspace_employees() -> str:
    """列出当前工作空间所有数字员工及其角色、技能、MCP 外接能力。

    系统 Prompt 已注入员工表时优先用表；招聘后或表可能过期时再调用。
    """
    db = get_db()
    workspace_id = get_workspace_id()
    return build_employee_capability_context(db, workspace_id)


@tool
def create_orchestration_plan(summary: str, tasks: str | list[Any]) -> str:
    """创建任务编排计划。调用时机：确认任务拆解和员工分配无误后调用。

    注意：禁止将同一 employee_id 拆成多条子任务；单员工多步须合并为一条 prompt。

    参数:
      summary: 编排计划的中文描述
      tasks: JSON 数组字符串，或直接传数组；每个元素格式:
        {{
          "employee_id": <int>,
          "task_name": "<任务名称>",
          "prompt": "<下发给该员工 Agent 的执行指令>",
          "dispatch_type": "skill",
          "skill_id": <int | null>,
          "cron": "<cron 表达式 | null>",
          "priority": <int>,
          "depends_on": <int | null>
        }}
    """
    db = get_db()
    workspace_id = get_workspace_id()
    conversation_id = get_conversation_id()

    if not conversation_id:
        return "错误：当前没有活跃的对话，无法创建编排计划。"

    task_list, parse_error = parse_orchestration_task_list(tasks)
    if parse_error:
        return parse_error
    assert task_list is not None

    validation_error = validate_orchestration_tasks(task_list)
    if validation_error:
        return validation_error

    for i, t in enumerate(task_list):
        emp = db.get(Employee, t.get("employee_id"))
        if not emp:
            return f"错误：子任务 #{i} 指定的员工 ID={t.get('employee_id')} 不存在。"

    plan = OrchestrationPlan(
        workspace_id=workspace_id,
        conversation_id=conversation_id,
        user_input=summary,
        plan_json=json.dumps(task_list, ensure_ascii=False),
        status="pending",
        total_tasks=len(task_list),
    )
    db.add(plan)
    db.flush()

    created_tasks: list[EmployeeTask] = []
    for t in task_list:
        cron_expr = t.get("cron")
        emp = db.get(Employee, t["employee_id"])
        task = EmployeeTask(
            workspace_id=workspace_id,
            employee_id=t["employee_id"],
            employee_name_snapshot=emp.name if emp else "",
            task_name=t["task_name"],
            dispatch_type=t.get("dispatch_type", "skill"),
            skill_id=t.get("skill_id"),
            cron_expression=cron_expr if cron_expr else "",
            cron_expression_type="custom",
            user_prompt=t.get("prompt", ""),
            execute_mode="scheduled" if cron_expr else "immediate",
            source="orchestration",
            orchestration_plan_id=plan.id,
            source_conversation_id=conversation_id,
            priority=t.get("priority", 0),
            is_active=True,
        )
        db.add(task)
        created_tasks.append(task)

    db.commit()
    for task in created_tasks:
        db.refresh(task)

    from src.service.workspace_events import WorkspaceEventBus

    requires_confirmation = compute_requires_confirmation(task_list)

    tasks_for_event: list[dict] = []
    for task in created_tasks:
        tasks_for_event.append({
            "task_id": task.id,
            "task_name": task.task_name,
            "employee_id": task.employee_id,
            "employee_name": task.employee_name_snapshot or "",
            "cron": task.cron_expression or None,
            "execute_mode": task.execute_mode,
        })
    WorkspaceEventBus.push(workspace_id, {
        "type": "orchestration_plan_generated",
        "plan_id": plan.id,
        "summary": summary,
        "total_tasks": len(task_list),
        "requires_confirmation": requires_confirmation,
        "tasks": tasks_for_event,
    })

    plan_json_output = json.dumps({
        "type": "plan_generated",
        "plan_id": plan.id,
        "summary": summary,
        "total_tasks": len(task_list),
        "requires_confirmation": requires_confirmation,
        "tasks": tasks_for_event,
    }, ensure_ascii=False)

    return (
        plan_json_output
        + "\n\n"
        + f"编排计划 #{plan.id} 已生成，包含 {len(task_list)} 个子任务。\n"
        f"requires_confirmation={str(requires_confirmation).lower()}；"
        f"{'须等用户确认后再' if requires_confirmation else '简单任务可立即'} "
        f"调用 confirm_orchestration_plan({plan.id})。\n"
        f"tasks[].task_id 为 employee_tasks 主键；plan_id={plan.id} 不可用于 "
        "delete_task/update_task。执行只能通过 confirm_orchestration_plan 工具生效。"
    )


@tool
def confirm_orchestration_plan(plan_id: int) -> str:
    """启动编排计划下所有子任务（各员工在独立会话执行）。

    简单任务可在 create 后同一轮调用；复杂任务须用户明确确认后再调用。
    调用后：向用户简短说明委派即可；禁止轮询 list_tasks，禁止代员工 shell/read 技能。
    """
    db = get_db()
    workspace_id = get_workspace_id()

    plan = db.get(OrchestrationPlan, plan_id)
    if not plan:
        return f"错误：编排计划 #{plan_id} 不存在。"

    if plan.status != "pending":
        return f"编排计划 #{plan_id} 当前状态为 {plan.status}，无法执行。"

    return execute_plan(db, plan, workspace_id)


@tool
def update_task(
    task_id: int,
    task_name: str | None = None,
    prompt: str | None = None,
    cron: str | None = None,
    employee_id: int | None = None,
) -> str:
    """修改已存在的子任务。参数均可选，只更新传入的非 None 字段。"""
    workspace_id = get_workspace_id()
    result = _update_task_with_fresh_session(
        workspace_id,
        task_id,
        task_name=task_name,
        prompt=prompt,
        cron=cron,
        employee_id=employee_id,
    )
    if result.get("error"):
        return f"错误：{result['error']}"

    changed = result.get("changed") or []
    if not changed:
        return result.get("message") or "未做任何修改。"

    if "调度时间" in changed:
        from src.service.task_scheduler_service import TaskSchedulerService

        TaskSchedulerService.reload_jobs()
    invalidate_orchestrator_db_cache()
    return result.get("message") or f"任务 #{task_id} 已更新。"


@tool
def delete_task(task_id: int) -> str:
    """删除单个子任务（物理删除，关联的执行记录会保留但 task_id 置空）。"""
    workspace_id = get_workspace_id()
    result = _delete_task_with_fresh_session(workspace_id, task_id)
    if result.get("error"):
        return f"错误：{result['error']}"

    from src.service.task_scheduler_service import TaskSchedulerService

    TaskSchedulerService.reload_jobs()
    invalidate_orchestrator_db_cache()
    task_name = result.get("task_name") or ""
    return f"任务 #{task_id} ({task_name}) 已删除。"


@tool
def delete_tasks_batch(task_ids: str) -> str:
    """批量删除多个子任务（一次调用，逐任务独立 Session，整批只刷新调度一次）。

    当用户要求删除 2 个及以上任务时使用本工具，不要用同一轮多次 delete_task。

    参数 task_ids: JSON 整数数组字符串，例如 "[31, 32, 33]"
    """
    workspace_id = get_workspace_id()

    try:
        parsed = json.loads(task_ids)
    except json.JSONDecodeError as exc:
        return f"错误：task_ids 不是合法的 JSON 数组: {exc}"

    if not isinstance(parsed, list):
        return "错误：task_ids 必须为 JSON 数组。"
    if len(parsed) == 0:
        return "错误：task_ids 不能为空。"
    if len(parsed) > MAX_TASK_DELETE_BATCH:
        return f"错误：单次最多删除 {MAX_TASK_DELETE_BATCH} 个任务。"

    normalized: list[int] = []
    for i, raw in enumerate(parsed):
        try:
            normalized.append(int(raw))
        except (TypeError, ValueError):
            return f"错误：task_ids[{i}] 不是有效整数: {raw!r}"

    raw = run_delete_tasks_batch(workspace_id, normalized, reload_scheduler=True)
    if not raw.startswith("错误："):
        invalidate_orchestrator_db_cache()
    return raw


@tool
def cancel_plan(plan_id: int) -> str:
    """取消整个编排计划（停用子任务、终止进行中执行、刷新调度）。"""
    db = get_db()
    from src.service.orchestration_lifecycle import cancel_orchestration_plan

    err = cancel_orchestration_plan(db, plan_id)
    if err:
        return f"错误：{err}"
    invalidate_orchestrator_db_cache()
    return f"编排计划 #{plan_id} 已取消。"


@tool
def list_tasks(
    status: str | None = None,
    plan_id: int | None = None,
    employee_id: int | None = None,
    limit: int = 20,
) -> str:
    """查询工作空间任务状态（数据库快照，非员工实时流）。

    适用：用户询问进度/结果、管理已有计划、多子任务汇总。
    禁止：confirm_orchestration_plan 之后为等待完成而反复调用；界面已有任务执行卡片。
    建议：带 plan_id 精确查询；limit 宜 ≤ 5。
    """
    db = get_db()
    workspace_id = get_workspace_id()

    query = select(EmployeeTask).where(
        EmployeeTask.workspace_id == workspace_id,
        EmployeeTask.is_active.is_(True),
    )

    if plan_id is not None:
        query = query.where(EmployeeTask.orchestration_plan_id == plan_id)
    if employee_id is not None:
        query = query.where(EmployeeTask.employee_id == employee_id)
    if status is not None:
        from src.models.task_execution_log import TaskExecutionLog

        if status in ("executing",):
            sub = select(TaskExecutionLog.task_id).where(
                TaskExecutionLog.run_status == "running"
            ).distinct()
            query = query.where(
                (EmployeeTask.execute_mode == "scheduled")
                | (EmployeeTask.id.in_(sub))
            )
        elif status in ("completed", "success"):
            sub = select(TaskExecutionLog.task_id).where(
                TaskExecutionLog.run_status == "success"
            ).distinct()
            query = query.where(EmployeeTask.id.in_(sub))
        elif status in ("failed", "timeout", "cancelled"):
            sub = select(TaskExecutionLog.task_id).where(
                TaskExecutionLog.run_status.in_(["failed", "timeout", "cancelled"])
            ).distinct()
            query = query.where(EmployeeTask.id.in_(sub))
        elif status == "pending":
            query = query.where(
                EmployeeTask.execute_mode == "scheduled",
                ~EmployeeTask.id.in_(
                    select(TaskExecutionLog.task_id).distinct()
                ),
            )

    tasks = list(
        db.scalars(
            query.order_by(EmployeeTask.priority.desc(), EmployeeTask.id.desc()).limit(limit)
        ).all()
    )

    if not tasks:
        return "没有找到匹配的任务。"

    lines = ["| ID | 任务名 | 员工 | 执行模式 | 状态 |", "|---|---|---|---|---|"]
    from src.models.task_execution_log import TaskExecutionLog

    for t in tasks:
        emp = db.get(Employee, t.employee_id)
        emp_name = emp.name if emp else (t.employee_name_snapshot or str(t.employee_id))
        mode = "定时" if t.execute_mode == "scheduled" else "即时"
        latest_log = db.scalars(
            select(TaskExecutionLog.run_status).where(
                TaskExecutionLog.task_id == t.id
            ).order_by(TaskExecutionLog.id.desc()).limit(1)
        ).first()
        task_status = latest_log or (
            "运行中" if t.execute_mode == "scheduled" else "未执行"
        )
        lines.append(f"| {t.id} | {t.task_name} | {emp_name} | {mode} | {task_status} |")

    return "\n".join(lines)


def _read_skill_file_map(skill_dir: Path) -> dict[str, str]:
    """读取技能目录下所有文件构建 file_map（相对路径 → 文本内容）。"""
    file_map: dict[str, str] = {}
    for fpath in skill_dir.rglob("*"):
        if not fpath.is_file():
            continue
        rel = fpath.relative_to(skill_dir).as_posix()
        try:
            file_map[rel] = fpath.read_text(encoding="utf-8")
        except Exception:
            pass
    return file_map


def _buildin_skills_root() -> Path | None:
    from src.service.agent.paths import BUILD_IN_SKILLS_DIR

    root = BUILD_IN_SKILLS_DIR.resolve()
    return root if root.is_dir() else None


def _get_installed_skill_names(workspace_id: int) -> set[str]:
    """获取当前工作区已安装的技能名称。"""
    installed: set[str] = set()
    for s in LocalSkillService.list_local_skills(workspace_id):
        name = s.get("skillName")
        if name:
            installed.add(name)
    return installed


def _preview_from_file_map(file_map: dict[str, str], max_lines: int = 40) -> str:
    skill_md = file_map.get("SKILL.md", "")
    if not skill_md:
        for path, content in file_map.items():
            if path.endswith("/SKILL.md") or path.lower().endswith("/skill.md"):
                skill_md = content
                break
    if not skill_md:
        return "（未包含 SKILL.md 预览）"
    lines = skill_md.splitlines()
    preview = "\n".join(lines[:max_lines])
    if len(lines) > max_lines:
        preview += f"\n...（共 {len(lines)} 行，仅显示前 {max_lines} 行）"
    return preview


def _format_market_skill_files(file_map: dict[str, str], max_names: int = 12) -> str:
    names = sorted(file_map.keys())
    if not names:
        return "（无文件清单）"
    shown = names[:max_names]
    lines = [f"- {name}" for name in shown]
    if len(names) > max_names:
        lines.append(f"... 还有 {len(names) - max_names} 个文件")
    return "\n".join(lines)


@tool
def list_builtin_skills(query: str = "") -> str:
    """列出安装包自带的内置技能（build-in-skills），按名称/描述过滤。

    在线模式请优先 search_market_skills 搜索 SkillsMP 技能仓库。
    内置技能安装用 install_builtin_skill。

    Args:
        query: 搜索关键词，为空时列出全部内置技能
    """
    workspace_id = get_workspace_id()
    installed = _get_installed_skill_names(workspace_id)
    q = query.lower().strip()

    lines: list[str] = []
    root = _buildin_skills_root()
    if root:
        for child in sorted(child for child in root.iterdir() if child.is_dir()):
            skill_md = child / "SKILL.md"
            if not skill_md.exists():
                continue
            name = child.name
            desc = ""
            try:
                text = skill_md.read_text("utf-8")
                for line in text.splitlines():
                    if line.startswith("description:"):
                        desc = line[len("description:"):].strip().strip('"')
                        break
            except Exception:
                pass

            if q and q not in name.lower() and q not in desc.lower():
                continue

            status = "已安装" if name in installed else "可安装"
            lines.append(f"- {name} [{status}]")
            if desc:
                lines.append(f"  描述: {desc[:120]}")

    if not lines:
        return "未找到匹配的技能。" if q else "技能目录为空。"

    header = f"内置技能（匹配「{query}」）：" if q else "安装包内置技能："
    return header + "\n" + "\n".join(lines)


@tool
def install_builtin_skill(skill_name: str, overwrite: bool = False) -> str:
    """安装一个内置技能到当前工作区的本地技能目录。

    安装后调用 list_workspace_skills 获取 localId，再 update_employee 分配给员工。

    Args:
        skill_name: 技能名称（与 list_builtin_skills 返回的名称一致）
        overwrite: 是否覆盖已安装的同名技能（默认 False）
    """
    workspace_id = get_workspace_id()
    name = skill_name.strip()

    root = _buildin_skills_root()
    if not root:
        return "错误：无法定位内置技能目录。"

    skill_dir = root / name
    if not skill_dir.is_dir() or not (skill_dir / "SKILL.md").is_file():
        return f"错误：未找到内置技能「{name}」。请先用 list_builtin_skills 搜索。"

    file_map = _read_skill_file_map(skill_dir)

    desc = ""
    skill_md_content = file_map.get("SKILL.md", "")
    for line in skill_md_content.splitlines():
        if line.startswith("description:"):
            desc = line[len("description:"):].strip().strip('"')
            break

    try:
        result = LocalSkillService.install_skill_from_file_map(
            skill_name=name,
            file_map=file_map,
            workspace_id=workspace_id,
            overwrite=overwrite,
            description=desc or None,
            source_file_name="builtin:build-in-skills",
        )
    except Exception as exc:
        return f"错误：安装失败 — {exc}"

    action = "已覆盖" if result.get("overwritten") else "已安装"
    return (
        f"✅ {action}技能「{result['skillName']}」(ID={result['localId']})\n"
        f"路径: {result['path']}"
    )


@tool
def search_market_skills(
    query: str,
    runtime: ToolRuntime[None, None] = None,
) -> str:
    """从 SkillsMP 公开目录搜索可安装技能（在线模式，无需登录）。

    完整浏览请打开 https://skillsmp.com/search
    安装前先用 get_market_skill_detail(skill_slug) 预览，确认后 install_market_skill(skill_slug)。

    Args:
        query: 搜索关键词（如「标书」「测试」「ppt」），必填
    """
    if not get_capabilities().remote_skills:
        return (
            "当前为离线模式，无法访问 SkillsMP 技能仓库。\n"
            "请用 list_builtin_skills 查看内置技能，或在客户端「技能」页导入 ZIP。"
        )

    q = query.strip()
    if not q:
        return (
            f"请提供搜索关键词，例如 search_market_skills(\"ppt\")。\n"
            f"也可在浏览器打开 {SKILL_MARKET_URL} 浏览全部技能。"
        )

    try:
        data = SkillsMpService.search(q, limit=20)
    except SkillsMpError as exc:
        return f"错误：{exc}"

    skills = data.get("skills") if isinstance(data, dict) else None
    if not isinstance(skills, list):
        return "错误：SkillsMP 搜索响应格式异常。"

    installed = _get_installed_skill_names(resolve_workspace_id(runtime))
    pagination = data.get("pagination") if isinstance(data, dict) else {}
    total = pagination.get("total") if isinstance(pagination, dict) else len(skills)

    lines = [
        f"SkillsMP 技能目录：{SKILL_MARKET_URL}",
        f"搜索结果（「{q}」）：",
        "",
    ]

    if not skills:
        lines.append(
            f"未找到匹配技能。建议在浏览器打开 {SKILL_MARKET_URL} 浏览，或换关键词再搜。"
        )
        return "\n".join(lines)

    for item in skills:
        if not isinstance(item, dict):
            continue
        slug = str(item.get("id") or "")
        name = str(item.get("name") or slug)
        author = str(item.get("author") or "")
        desc = str(item.get("description") or "")[:100]
        skill_url = str(item.get("skillUrl") or f"https://skillsmp.com/skills/{slug}")
        stars = item.get("stars")
        status = "已安装" if name in installed else "可安装"
        lines.append(f"- slug={slug}")
        lines.append(f"  名称: {name} ({author}) [{status}]")
        if desc:
            lines.append(f"  描述: {desc}")
        if isinstance(stars, int) and stars > 0:
            lines.append(f"  Stars: {stars}")
        lines.append(f"  页面: {skill_url}")

    if isinstance(total, int) and total > len(skills):
        lines.append(
            f"... 共约 {total} 个结果，仅显示前 {len(skills)} 个。"
            f"可在 {SKILL_MARKET_URL} 继续浏览。"
        )

    lines.extend(
        [
            "",
            "预览: get_market_skill_detail(skill_slug)",
            "安装: install_market_skill(skill_slug)",
            "说明: slug 为字符串（如 openclaw-openclaw-agents-skills-control-ui-e2e-skill-md），"
            "不是 localId 或平台远程技能 id。",
        ]
    )
    return "\n".join(lines)


@tool
def get_market_skill_detail(
    skill_slug: str,
    runtime: ToolRuntime[None, None] = None,
) -> str:
    """预览 SkillsMP 目录中的某个技能详情（不安装）。

    确认符合需求后再调用 install_market_skill(skill_slug) 安装到本机工作区。

    Args:
        skill_slug: search_market_skills 返回的 slug 字符串
    """
    if not get_capabilities().remote_skills:
        return "当前为离线模式，无法访问 SkillsMP 技能目录。"

    slug = skill_slug.strip()
    if not slug:
        return "错误：skill_slug 不能为空。"

    try:
        detail = SkillsMpService.get_skill(slug)
    except SkillsMpError as exc:
        return f"错误：获取技能详情失败 — {exc}"

    name = detail.get("name") or "?"
    author = detail.get("author") or "?"
    desc = detail.get("description") or "无"
    github_url = detail.get("githubUrl") or "无"
    skill_url = detail.get("skillUrl") or f"https://skillsmp.com/skills/{slug}"
    stars = detail.get("stars")

    preview = "（正在从 GitHub 拉取 SKILL.md…）"
    file_list = ""
    contents_url = "无"
    github = str(github_url)
    if github.startswith("http"):
        try:
            parsed = SkillsMpService.parse_github_tree_url(github)
            contents_url = SkillsMpService.github_contents_url(parsed)
            file_map = SkillsMpService.fetch_skill_file_map(github)
            preview = _preview_from_file_map(file_map)
            file_list = _format_market_skill_files(file_map)
        except SkillsMpError as exc:
            preview = f"（无法拉取 SKILL.md: {exc}）"
            contents_url = github
    else:
        contents_url = "无"

    stars_line = f"Stars: {stars}\n" if isinstance(stars, int) and stars > 0 else ""

    return (
        f"📄 SkillsMP 技能 slug={slug}\n"
        f"名称: {name} (作者: {author})\n"
        f"描述: {desc}\n"
        f"{stars_line}"
        f"页面: {skill_url}\n"
        f"GitHub: {github_url}\n"
        f"下载源: {contents_url}\n"
        f"\n--- 文件清单 ---\n{file_list or '（未能获取）'}\n"
        f"\n--- SKILL.md 预览 ---\n{preview}\n"
        f"\n---\n确认安装请调用 install_market_skill(\"{slug}\")"
    )


@tool
def install_market_skill(
    skill_slug: str,
    overwrite: bool = False,
    runtime: ToolRuntime[None, None] = None,
) -> str:
    """从 SkillsMP 目录安装技能到当前工作区本地目录（无需登录）。

    安装路径：~/.digital-employee/local-skills/<workspace_id>/<skill_name>/
    安装后调用 list_workspace_skills 获取 localId，再 update_employee 分配给员工。

    Args:
        skill_slug: search_market_skills 或 get_market_skill_detail 返回的 slug 字符串
        overwrite: 是否覆盖已安装的同名技能（默认 False）
    """
    if not get_capabilities().remote_skills:
        return "当前为离线模式，无法从 SkillsMP 安装。请使用 list_builtin_skills 或 ZIP 导入。"

    slug = skill_slug.strip()
    if not slug:
        return "错误：skill_slug 不能为空。"

    workspace_id = resolve_workspace_id(runtime)
    try:
        result = SkillsMpService.install_from_slug(
            slug,
            workspace_id,
            overwrite=overwrite,
        )
    except SkillsMpError as exc:
        return f"错误：安装失败 — {exc}"
    except HTTPException as exc:
        detail_msg = exc.detail
        if isinstance(detail_msg, list):
            detail_msg = "; ".join(str(d) for d in detail_msg)
        return f"错误：安装失败 — {detail_msg or exc}"
    except Exception as exc:
        return f"错误：安装失败 — {exc}"

    action = "已覆盖" if result.get("overwritten") else "已安装"
    return (
        f"✅ {action}技能「{result['skillName']}」(localId={result['localId']})\n"
        f"来源: SkillsMP (slug={slug})\n"
        f"路径: {result['path']}\n"
        f"下一步: list_workspace_skills → update_employee 分配 skill_ids"
    )
