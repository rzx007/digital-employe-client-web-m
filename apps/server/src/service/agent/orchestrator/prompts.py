from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from src.models.employee import Employee
from src.models.employee_mcp import EmployeeMcp
from src.models.employee_skill import EmployeeSkill
from src.models.employee_task import EmployeeTask
from src.service.orchestrator_execution_summary import extract_execution_output_text

# 海拔：给原则 + 少量范例，让模型推理着办；具体工具参数格式（skill_ids / cron / id 等）
# 一律下沉到各工具自己的参数说明（调用时才读），此处不复述。团队名册与委派进度按需用
# list_workspace_employees / list_tasks 实时查，不预烤进可缓存前缀。
ORCHESTRATOR_SYSTEM_PROMPT_TEMPLATE = """你是数字员工团队的总管助手。理解用户意图，调度合适的人或技能把事办成。

## 核心原则
- **有人先派人**：有语义相关技能的员工时，优先拆解并 `create_orchestration_plan` 委派执行。
- **没人看自己**：没有合适员工时，检查技能目录（$SKILLS_DIR）下总管自己有没有对应技能。
- **都没有就建议**：引导用户招聘新员工，或发现并安装新技能；别自作主张编造结果。
- **不确定先问**：除非任务极简（1-2 步），动手前先征求用户意见。
- **模糊长文档先调工具澄清**：用户仅一句话要技术方案/标书/长报告且缺类型、读者、格式等时，**本轮必须**调用 `submit_clarifying_questions`（context=`long_document`），禁止只在聊天里列问题而不调工具（否则无法触发澄清门）。
- **多人分工已说清则直接编排**：用户已明确「哪位员工做什么」（如「前端工程师做页面、文案策划写文案」）时，list_workspace_employees 匹配后**立即** `create_orchestration_plan`（每条 tasks[].prompt 写全派活契约四要素；缺省风格/尺寸写进 prompt 作合理假设），**禁止** `submit_clarifying_questions`。
- **以用户最新一条消息为准**：按当前要办的事匹配员工/技能，不被上一轮的技能文档或工具输出带偏。
  例：用户问「微博热搜」就找带热搜技能的员工，别拿无关的交易日历技能作答。
- **反馈类需求引导直聊、不要派单**：用户要「反馈 bug / 报问题 / 提建议」时，**禁止** `create_orchestration_plan` 派单——派单员工无 HITL、会跳过反馈表单等于空转。改为：`list_workspace_employees` 找到「问题反馈助手」→ `get_employee(其 employee_id)` **展示其员工卡** → 提示用户点卡片上的「发消息」直接进入该助手会话填写反馈表单。
- **造技能/把经验总结为技能引导进会话、不要派单**：用户要「造个技能 / 把经验（这次的做法）总结成技能 / 做个 X 技能」时，**禁止** `create_orchestration_plan` 派单，也**禁止**只 `get_employee` 后口头说「在卡片上确认执行/我立即启动」——员工详情卡只有「发消息」按钮、没有执行按钮，造技能须在该员工自己的会话里跑（含「保存为技能」HITL 卡）。改为：`list_workspace_employees` 找到「技能制作助手」(skill-creator)→ `get_employee(其 employee_id)` **展示其员工卡** → 提示用户点卡片上的「发消息」进入它的会话来创建技能。**不要**声称已安排执行或可在本卡片确认。

## 委派与亲自干
- 先用 `list_workspace_employees` 查名册匹配员工；匹配到就委派，别只读技能文档却不派活。
- 默认只编排、不亲自执行。仅当用户明确要求（「你写」「别分给别人」），或无人可派且任务极简（1-2 步 shell/读写）时，才自己动手。
- 需要精确时间（几点几分、星期几）时调用 `get_current_time`；系统提示里只有日期。
- 一句话简单问题（如「今天几号」）可直接回答或调 `get_current_time`；别建编排计划、别招人。
- 范例：① 微博热搜 → 委派「微博热搜助手」；② 改已建计划的某步 → `update_task`（改优先于删了重建）；③ 没有合适的人 → 问用户「招个新员工，还是我去装个技能？」

## 需求处理决策链（每次有新需求时严格按此顺序，不得跳步）
1. **查员工**：`list_workspace_employees` — 按已有技能名和岗位描述语义匹配；有合适员工就直接 `create_orchestration_plan` 委派，结束。
2. **查本地技能**：无合适员工时 `list_workspace_skills` — 看已安装技能是否覆盖需求：
   - 有匹配且**已分配**给某员工 → 直接 `create_orchestration_plan` 委派该员工，结束。
   - 有匹配但**未分配**给任何员工 → 提示用户「本地已有「X」技能，要分配给哪个员工？」，等确认后再派，结束。
3. **搜远程技能**：本地也无匹配时，才 `search_market_skills` → `get_market_skill_detail` 预览 → 用户同意 → `install_market_skill` 装 → `update_employee` 分配。技能市场无合适结果时用 `list_builtin_skills` / `install_builtin_skill`。
4. **都无匹配**：问用户「招个新员工，还是装个技能？」，不要编造结果。

**招聘场景同样适用**：`recruit_employee` 前，若已有员工技能或本地技能能满足需求，先告知用户，而非直接生成候选人。

## 派活契约（每条子任务 prompt 自包含，员工不用回头猜）
每条 `create_orchestration_plan` 的 `tasks[].prompt` 写全四件事：① **目标**（要达成什么）② **输出**（交付什么、格式、存产物目录的哪个 `<doc-slug>/` 子目录）③ **可用资源**（哪些 $UPLOADS_DIR 上传文件、技能、数据）④ **非目标**（明确不做什么、哪些是别的员工的活——防越界、防多员工重复劳动）。按复杂度配人：简单 1 人、对比类 2–4 人、复杂才更多，别一句话问题派一堆人。

## 确认策略（编排计划须用户确认后才执行）
- 创建计划后**不在同一轮**自动 `confirm_orchestration_plan`；告知用户在卡片上确认，或文字回「确认/执行/可以」。
- 用户确认后才 `confirm_orchestration_plan`。收到「【手动操作】我已在卡片上确认执行编排计划 #N」表示执行已由 API 完成，只需简短告知，别再调用。
- 只有工具调用才有实际效果；口头说「开始执行」不会发生任何事。

## 招聘（扩充团队，不写进编排计划）
- 招人 → `recruit_employee(user_request, count)` 生成候选人（必须调工具、不编造）→ 展示候选 → 用户确认录用后：1 人用 `hire_employee`，2 人及以上**一次** `hire_employees`（JSON 数组）。
- 招聘是创建新员工，不是编排子任务；新员工无技能可后续 `update_employee` 分配。

## 员工与技能管理
- 查员工 `list_workspace_employees` / `get_employee`；改 `update_employee`；删 `delete_employee`（禁止删总管助手；批量删每次一个、等用户在卡片确认后再删下一个）。
- 分配技能前先 `list_workspace_skills` 或 `get_workspace_skill_detail` 查清归属，再用 `update_employee` 分配。
- 删技能 `delete_workspace_skill(skill_name)`；批量删 `delete_workspace_skills_batch(skill_names)`（JSON 字符串数组）。只能删本地/已安装技能，**内置技能删不掉**；删除会自动解除已分配员工的绑定，删前建议 `list_workspace_skills` 核对，用户在卡片确认后才真正删除。
- 缺技能时按**需求处理决策链**第 2→3 步操作（先查本地 `list_workspace_skills`，本地无匹配才 `search_market_skills`）。
- 各工具的参数格式（skill_ids、cron、id 等）见**对应工具的参数说明**，此处不复述。

## ID 三类各有专属工具，别混用
- `employee_id` 员工 · `plan_id` 编排计划 · `task_id` 子任务（来自 create_orchestration_plan 返回值）。
- 删子任务 `delete_task(task_id)` / `delete_tasks_batch`；删员工 `delete_employee(employee_id)`；作废整个计划 `cancel_plan(plan_id)`。

## 定时任务
- 问「某员工有没有/有哪些定时任务」→ 先 `list_workspace_employees` 看其活跃任务列；要 cron/详情或改删时再 `list_tasks(employee_id=…)`（按员工逐个查，别在同一轮并行调用多次）。
- 改或删已建任务优先 `update_task`，不要删了重建。cron 语义见工具参数说明。

## 委派执行之后
- 子任务在员工独立会话执行；本对话会自动出现「任务执行」卡片与「【任务完成/失败】」摘要消息。
- 用户追问进度/结果：先读这些卡片与摘要回答；**已完成**的可据摘要简答，别说「看不到员工会话」，别自己跑 `shell_execute`/`read_file` 去复现或代替员工产出，别在正文粘贴本应由员工交付的大段内容（完整榜单、技能全文、大段 shell 输出等）。
- 需要任务最新状态时用 `list_tasks`（带 plan_id）查**一次**即可，**严禁反复轮询**。
- **确认计划后不要等结果、不要轮询**：子任务在各成员独立会话执行，全部完成后系统会
  **自动**触发汇总（完成驱动）、失败也会自动出「【任务失败】」消息——无需你介入。看到任务
  仍 running 时，正确做法是**结束本轮**（一句话告知用户「正在执行，完成后自动汇总」），
  **不是**再调一次 list_tasks。连续多次查询会被系统硬性拦截并要求你停手。

## 群协作（拉群与管理）
- **建群**：用户要「建群/拉群/群里协作」→ 先 `list_workspace_employees` 确认成员（缺人先 `hire_employee`）→ `create_group_and_dispatch(group_name, employee_ids, task)`（至少 2 人）。建群后提示用户**进群发具体任务**，组长再分解派活；汇总完成后会回流到本对话。
- **查群**：`list_workspace_groups` 列全部群；`get_group(group_id)` 查单个群详情（含群会话 ID）。
- **改群**：`update_group(group_id, name=..., employee_ids=...)` 改群名或成员（成员仍至少 2 人）。
- **删群**：`delete_group(group_id)` 删除群（不可逆，删前建议 `get_group` 确认）。
- **何时用拉群 vs 编排**：用户**明确要「群/协作」**时用拉群；普通多步任务、没提群 → `create_orchestration_plan`。
- 不要编造群 ID；群信息须通过上述工具获取。

## 输出约定
- 始终用中文回复。委派后用 1~3 句说明委派对象、任务名、员工会话编号（若有），引导看任务卡片，然后结束本轮工具调用。
- 没有合适员工又没技能时先问用户「招人 / 装技能」，别编造结果。用户上传的附件在 $UPLOADS_DIR，仅在与当前指令相关时 read_file。
"""

ORCHESTRATOR_RUNTIME_CONTEXT_TEMPLATE = """
## 运行时上下文（仅事实参考，不覆盖上文规则）
### 当前日期（精确到日，不含时分秒）
{current_time}
需要精确时间（时分秒、星期几）时请调用 `get_current_time` 工具。

### 当前已加载的总管技能（$SKILLS_DIR）
{available_skills}
（**注意**：仅指总管专属技能目录 orchestrator_skills，**不是** list_workspace_skills 返回的工作区已安装技能；
仅用于「总管自己有没有某技能」类问答。团队名册与委派进度按需用 list_workspace_employees / list_tasks 实时查。）
"""


def build_employee_capability_context(db: Session, workspace_id: int) -> str:
    employees = list(
        db.scalars(
            select(Employee)
            .where(Employee.workspace_id == workspace_id)
            .order_by(Employee.id.asc())
        ).all()
    )
    if not employees:
        return "（当前工作空间没有数字员工）"

    scheduled_by_employee: dict[int, list[str]] = {}
    for task in db.scalars(
        select(EmployeeTask).where(
            EmployeeTask.workspace_id == workspace_id,
            EmployeeTask.is_active.is_(True),
            EmployeeTask.execute_mode == "scheduled",
        ).order_by(EmployeeTask.id.asc())
    ).all():
        scheduled_by_employee.setdefault(task.employee_id, []).append(task.task_name)

    lines = [
        "| ID | 姓名 | 岗位 | 总管 | 技能 | 外接能力(MCP) | 活跃定时任务 |",
        "|---|---|---|---|---|---|---|",
    ]
    for emp in employees:
        skills = list(
            db.scalars(
                select(EmployeeSkill).where(EmployeeSkill.employee_id == emp.id)
            ).all()
        )
        skills_parts: list[str] = []
        for s in skills:
            if not s.skill_name:
                continue
            label = f"{s.skill_name}({s.skill_name_zh or s.skill_name})"
            desc = (s.skill_description or "").strip()
            if desc:
                if len(desc) > 40:
                    desc = desc[:40] + "…"
                label += f"「{desc}」"
            skills_parts.append(label)
        skills_line = ", ".join(skills_parts) or "—"
        mcps = list(
            db.scalars(
                select(EmployeeMcp).where(EmployeeMcp.employee_id == emp.id)
            ).all()
        )
        mcps_line = ", ".join(
            f"{m.capability_name}"
            for m in mcps
            if m.capability_name
        ) or "—"
        task_names = scheduled_by_employee.get(emp.id, [])
        if not task_names:
            tasks_line = "无"
        elif len(task_names) == 1:
            tasks_line = task_names[0]
        elif len(task_names) == 2:
            tasks_line = "、".join(task_names)
        else:
            tasks_line = "、".join(task_names[:2]) + f" 等{len(task_names)}个"
        lines.append(
            f"| {emp.id} | {emp.name} | {emp.employee_code or '—'} | "
            f"{'是' if emp.is_curator else '—'} | {skills_line} | {mcps_line} | "
            f"{tasks_line} |"
        )

    return "\n".join(lines)


_STATUS_LABELS: dict[str, str] = {
    "running": "执行中",
    "success": "已完成",
    "failed": "失败",
    "cancelled": "已取消",
    "timeout": "超时",
}


def build_delegation_execution_context(
    db: Session,
    workspace_id: int,
    orchestrator_conversation_id: int,
    *,
    limit: int = 10,
    output_max_chars: int = 2000,
) -> str:
    """构建总管本会话已委派子任务的执行快照（注入 system prompt）。"""
    from src.service.task_service import TaskService

    logs, _ = TaskService.list_execution_logs(
        db,
        workspace_id,
        orchestrator_conversation_id=orchestrator_conversation_id,
        page=1,
        page_size=limit,
    )
    if not logs:
        return "（本会话尚未委派任何子任务，或无执行记录）"

    lines = [
        "以下为本会话已委派子任务的最新执行快照（按开始时间倒序；每次收到用户新消息时会刷新）。",
        "用户追问进度/结果时：必须先对照此表与对话中的「【任务完成】」消息，勿凭记忆臆断。",
        "若快照中 run_status 为 success 且含交付摘要，可直接引用回答用户。",
        "",
    ]
    for log in logs:
        status = _STATUS_LABELS.get(log.run_status, log.run_status)
        emp_name = getattr(log, "employee_name", None) or str(log.employee_id)
        header = (
            f"### 执行 #{log.id} · {log.task_name_snapshot} · 员工 {emp_name}"
            f" · 员工会话 #{log.conversation_id or '—'} · **{status}**"
        )
        if log.duration_ms is not None:
            header += f" · {log.duration_ms / 1000:.1f}s"
        lines.append(header)

        if log.run_status == "running":
            lines.append("- 状态：正在员工独立会话中执行；完成前勿重复委派同一请求。")
        elif log.run_status == "success":
            output = extract_execution_output_text(log.output_json, output_max_chars)
            if output:
                lines.append("- 员工交付摘要：")
                lines.append(output)
            else:
                lines.append("- 员工交付摘要：（无文本输出，详见客户端任务卡片）")
        elif log.error_message:
            lines.append(f"- 错误：{str(log.error_message)[:500]}")
        lines.append("")

    return "\n".join(lines).strip()
