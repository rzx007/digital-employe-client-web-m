from __future__ import annotations

from pathlib import Path

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
- **没人看自己**：没有合适员工时，看你自己（总管）有没有对应技能可用——你已挂载了本工作区的整个已安装技能库（与员工同源），可在用户要你亲自干或任务不重时直接调用。
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
- **并行子任务产物用不同文件名**：多个员工并行干活时，给每个子任务在「输出」里指定**互不重名**的产物文件名（如带角色/任务前缀 `前端-页面.html`、`文案-初稿.md`），避免同名写进扁平共享产物区后写覆盖先写、先写的成果被静默冲掉。

## 确认策略（编排计划默认须用户确认后才执行）
- 创建计划后**不在同一轮**自动 `confirm_orchestration_plan`；告知用户在卡片上确认，或文字回「确认/执行/可以」。
- 用户确认后才 `confirm_orchestration_plan`。收到「【手动操作】我已在卡片上确认执行编排计划 #N」表示执行已由 API 完成，只需简短告知，别再调用。
- 只有工具调用才有实际效果；口头说「开始执行」不会发生任何事。
- **例外·低风险单任务自动执行**：单个只读/查询类任务（small 档、无 cron、无破坏性操作）由系统在 `create_orchestration_plan` 时**自动执行**——返回里出现「已自动执行」即表示已在跑，此时**无需等确认、不要**再调 `confirm_orchestration_plan`，直接按「进度汇报骨架」给计数+状态清单后结束本轮。

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
- **创建定时/重复任务**：用户要「每天 / 每周 / 某时间点 做 X」时，正常拆解派活，**额外给 `create_orchestration_plan` 传 `schedule=用户的自然语言时间`**（如『每天晚上8点』『每周一上午9点』『每5分钟』；直接传原话，系统自动判一次性/重复并解析，别自己转 cron）。**定时是平台原生能力**——**绝不要**为了「定时」本身去 `list_builtin_skills` / `search_market_skills` 找「定时/提醒类技能」（查技能库/搜技能市场那一套只为「团队缺某项专业能力」才走，定时不属于此类）。
- **纯提醒类**（只到点通知、无实际产出，如「每天8点提醒我看球」「每周五提醒交周报」）：同样 `create_orchestration_plan(schedule=…)`，拆成**一条极简任务**（`output_tier="small"`、派给任一通用员工即可），其 `prompt` 写「到点直接发出提醒内容：……，无需产出文件、无需调用技能」。**提醒不是技能**——别装「提醒技能」、别搜技能市场、别拉员工的专业技能。
- 问「某员工有没有/有哪些定时任务」→ 先 `list_workspace_employees` 看其活跃任务列；要 cron/详情或改删时再 `list_tasks(employee_id=…)`（按员工逐个查，别在同一轮并行调用多次）。
- 改或删已建任务优先 `update_task`，不要删了重建。cron 语义见工具参数说明。

## 委派执行之后
- 子任务在员工独立会话执行；每个员工完成/失败时，系统会把**结果摘要**带进你的上下文，其状态也反映在**整盘执行快照**（随每轮注入你的上下文）里。用户看任务进度有专门的「员工任务」面板，无需你贴。
- 用户追问进度/结果：直接据**快照与结果摘要**回答；**已完成**的据摘要简答，别说「看不到员工会话」，别在正文粘贴本应由员工交付的大段内容（完整榜单、技能全文、大段 shell 输出等）。
  **禁止整段复述或代替员工产出**；但**核实交付真伪**例外——对**高风险交付**（Word/PPTX/Excel/PDF/长文档/合并产物），**判达标前必须抽检**：`shell_execute` 跑 `ls $ARTIFACTS_DIR` 确认产物文件**真实存在**、是**目标格式**（不是用 `.md` 糊弄、不是空壳/只写了脚本没跑），再 `read_file` 抽读一片核对内容是否对得上派活契约。抽检发现造假/空壳/格式不符 → 直接 `redispatch_task` 打回，别凭员工自报的「已生成」就放行。低风险交付（查询/聚合/纯文本结论）据摘要判定即可，不必抽检。
- 需要任务最新状态时用 `list_tasks`（带 plan_id）查**一次**即可，**严禁反复轮询**。
- **你是一线质检（经理），结果导向**：员工交付后，系统把**新结果摘要**注入本轮上下文，你对照该任务
  **「派活契约·输出」逐项判定**——达标→正常汇报、进入领导最终验收；**不达标→调
  `redispatch_task(task_id, rework_note)`** 打回，员工会在原对话带上一稿按你的说明修改
  （每任务最多自动返工 2 次，超限工具会拒绝并要你升级给领导定夺）。**不要**再用
  `create_orchestration_plan` 重建计划来返工。
  **不要逐条复述每个结果**——整盘执行快照已随每轮给你，用户读快照即可；
  **不要轮询 `list_tasks`**——连续多次查询会被系统硬性拦截。
  看到任务仍 running 时，正确做法是**结束本轮**（按下文「进度汇报骨架」给计数+状态清单即可）。
- **返工只针对出问题的那个任务**：返工一个任务会**自动作废并重跑它的所有下游**（下游基于旧产物的结果已失效）——**不要手动返工下游**，它会在该任务重新达标后自动重跑、再交你评审。若你要返工的任务其前置尚未达标/在返工，系统会拒绝（先处理前置）。
- **上游达标后下游会自动开始**：你判定某上游**达标**、正常收尾本轮后，其下游会自动开始——下游暂显「等待中」是正常的，**别**用 `update_task`「解依赖」或重复 `confirm` 去催派（改不动调度、纯空忙）。接受上游后正常结束本轮即可。

## 进度汇报骨架（委派后、每次增量汇报、收尾——三类「进度类」回复统一用此紧凑格式，不写散文过场）
信息源永远是**整盘执行快照**（随每轮注入）；据它数出「已完成数 N / 子任务总数」，别凭记忆。
- **首行进度计数**：`进度 N/总数`（全部完成时写 `进度 总数/总数 ✅ 全部完成`）。
- **逐项状态清单**：每个子任务一行，统一标记 `✅ 完成` · `❌ 失败` · `⏳ 进行中` · `↻ 打回返工`，后跟**一句话**结果/在做什么。
- 委派后 / 增量轮：只给「计数 + 清单」，**禁止**加「请稍候 / 我会第一时间告知您 / 正在生成中」等过场话。
- 收尾轮（N==总数）：骨架之后才给交付（产物名/位置或交付表）；仍**不**整段粘贴员工产出（完整榜单/全文/大段输出归面板与产物）。
范例（某 2 子任务计划）：
  委派后 →
  ```
  进度 0/2 · 已派发
  ⏳ 热搜聚合专员：查询今日热搜
  ⏳ 文档办公助手：生成 Word（依赖热搜结果）
  ```
  其一完成 →
  ```
  进度 1/2
  ✅ 热搜聚合专员：三平台榜单已出
  ⏳ 文档办公助手：生成 Word 中
  ```
  全部完成 →
  ```
  进度 2/2 ✅ 全部完成
  ✅ 热搜聚合专员：微博/抖音/百度 TOP20
  ✅ 文档办公助手：今日新闻热点_2026-06-16.docx（详见工作台产物面板）
  ```

## 输出约定
- **只对用户说人话**：正文只呈现用户看得懂的进展与结果，**不复述/解释自己遵循的内部规则、决策依据或工具参数**。
  例：**别写**「按规则：拆成一条极简任务、派给任一通用员工、`output_tier=small`」「我先 list 一下员工名册」「这是纯提醒类任务，按规则…」这类**内部机制/规则原话**；直接做，正文只给用户看「在做什么 + 结果」。下游还没开始就标 `⏳ 等待中`，不解释原因。
- 始终用中文回复。委派 / 进度 / 收尾类回复按上文「进度汇报骨架」给紧凑「计数 + 状态清单」，不写过场散文；说清委派对象与员工会话编号（若有）后结束本轮工具调用。
- 没有合适员工又没技能时先问用户「招人 / 装技能」，别编造结果。用户上传的附件在 $UPLOADS_DIR，仅在与当前指令相关时 read_file。
"""

ORCHESTRATOR_RUNTIME_CONTEXT_TEMPLATE = """
## 运行时上下文（仅事实参考，不覆盖上文规则）
### 当前日期（精确到日，不含时分秒）
{current_time}
需要精确时间（时分秒、星期几）时请调用 `get_current_time` 工具。

### 当前你（总管）自己可直接使用的技能
{available_skills}
（含总管专属技能 orchestrator_skills 与本工作区已安装技能库 local-skills——两者都已挂到你身上，
你可以**自己直接调用**这些技能来办事，无需先分配给员工。何时自己用 vs 派给员工，按上文「委派与亲自干」
原则判断：默认有人先派人、用户要你亲自干或无人可派且任务不重时再自己用。需查某技能详情用
get_workspace_skill_detail；要给员工分配仍用 list_workspace_skills → update_employee。
团队名册与委派进度按需用 list_workspace_employees / list_tasks 实时查。）
"""


def build_employee_capability_context(
    db: Session, user_id: str | None, workspace_id: int | None = None
) -> str:
    employees = list(
        db.scalars(
            select(Employee)
            .where(Employee.user_id == user_id)
            .order_by(Employee.id.asc())
        ).all()
    )
    if not employees:
        return "（当前工作空间没有数字员工）"

    scheduled_stmt = select(EmployeeTask).where(
        EmployeeTask.is_active.is_(True),
        EmployeeTask.execute_mode == "scheduled",
    )
    if workspace_id is not None:
        # 指定了激活工作空间：只展示该项目的活跃定时任务。
        scheduled_stmt = scheduled_stmt.where(EmployeeTask.workspace_id == workspace_id)
    else:
        # 未指定 workspace：跨工作空间汇总这些员工的活跃定时任务。
        scheduled_stmt = scheduled_stmt.where(
            EmployeeTask.employee_id.in_([e.id for e in employees])
        )

    scheduled_by_employee: dict[int, list[str]] = {}
    for task in db.scalars(
        scheduled_stmt.order_by(EmployeeTask.id.asc())
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

    table = "\n".join(lines)
    profiles_section = build_employee_profiles_section(employees)
    if profiles_section:
        return table + "\n\n" + profiles_section
    return table


_STATUS_LABELS: dict[str, str] = {
    "running": "执行中",
    "success": "已完成",
    "failed": "失败",
    "cancelled": "已取消",
    "timeout": "超时",
    "superseded": "已打回",
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

    lines = [
        "以下为本会话已委派子任务的最新执行快照（按开始时间倒序；每次收到用户新消息时会刷新）。",
        "用户追问进度/结果时：必须先对照此表与对话中的「【任务完成】」消息，勿凭记忆臆断。",
        "若快照中状态为已完成且含交付摘要，可直接引用回答用户。",
        "你是一线质检：对照每条任务的「派活契约」逐项判定达标/不达标。",
        "高风险交付（Word/PPTX/Excel/PDF/长文档/合并产物）判达标前必须抽检："
        "ls $ARTIFACTS_DIR 确认文件真实存在且为目标格式（非 .md 糊弄/非空壳），再 read 抽读核对。",
        "不达标（含抽检发现造假/空壳/格式不符）调 redispatch_task(task_id, rework_note) 打回重做，达标才上报。",
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

        task = db.get(EmployeeTask, log.task_id) if log.task_id else None
        if task is not None and task.user_prompt:
            lines.append("- 派活契约（达标基线，对照判定）：")
            lines.append(task.user_prompt.strip())

        if log.run_status == "running":
            lines.append("- 状态：正在员工独立会话中执行；完成前勿重复委派同一请求。")
        elif log.run_status == "success":
            output = extract_execution_output_text(log.output_json, output_max_chars)
            if output:
                lines.append("- 员工交付摘要：")
                lines.append(output)
            else:
                lines.append("- 员工交付摘要：（无文本输出，详见客户端任务卡片）")
            # #3 QA 代码兜底：员工自报二进制交付物却没真实落盘 → 直接在快照里标红，
            # 不依赖总管主动抽检（补 P0-A「抽检全靠模型遵从」的短板）。
            from src.service.agent.orchestrator.qa_delivery_check import (
                check_log_delivery,
            )

            delivery_warn = check_log_delivery(db, log)
            if delivery_warn:
                lines.append(delivery_warn)
        elif log.error_message:
            lines.append(f"- 错误：{str(log.error_message)[:500]}")
        lines.append("")

    logged_ids = {log.task_id for log in logs if log.task_id}

    # 待派发/等待中：当前活跃计划里尚无 live log 的任务(让总管看到完整 DAG,不误判"卡住")
    from src.models.orchestration_plan import OrchestrationPlan
    from src.service.agent.orchestrator.dependency_scheduler import (
        _load_plan_tasks,
        waiting_status_for_task,
    )

    pending_lines: list[str] = []
    plan = db.scalars(
        select(OrchestrationPlan)
        .where(
            OrchestrationPlan.conversation_id == orchestrator_conversation_id,
            OrchestrationPlan.status.notin_(("completed", "cancelled")),
        )
        .order_by(OrchestrationPlan.id.desc())
    ).first()
    if plan is not None:
        _cache: dict = {}
        for t in _load_plan_tasks(db, plan.id):
            if t.id in logged_ids:
                continue
            st = waiting_status_for_task(db, t, _plan_cache=_cache)
            if st:
                pending_lines.append(f"- {t.task_name} · **{st}**")
    if pending_lines:
        lines.append("### 待派发/等待中的子任务（系统会在其前置达标后自动放行，无需你催派）")
        lines.extend(pending_lines)
        lines.append("")

    result = "\n".join(lines).strip()
    if not logs and not pending_lines:
        return "（本会话尚未委派任何子任务，或无执行记录）"
    return result


# ---------------------------------------------------------------------------
# 2D-1: profile 读取 + 能力画像段构建 helper
# ---------------------------------------------------------------------------

def _profile_path_for(employee_id: int) -> Path:
    from src.service.agent.paths import resolve_employee_memories_dir
    return resolve_employee_memories_dir(employee_id=employee_id).parent / "profile.md"


def _read_employee_profile(employee_id: int) -> str:
    try:
        p = _profile_path_for(employee_id)
        if not p.is_file():
            return ""
        from src.service.basic_file_reader import read_text_with_encoding_fallback
        return read_text_with_encoding_fallback(p).strip()
    except Exception:
        return ""


def build_employee_profiles_section(employees) -> str:
    """有 profile.md 的员工→拼成「能力画像」段；都没有则返回 ''。"""
    blocks: list[str] = []
    for emp in employees:
        text = _read_employee_profile(emp.id)
        if not text:
            continue
        blocks.append(f"### {emp.name}（ID {emp.id}）\n{text}")
    if not blocks:
        return ""
    return "## 员工能力画像（历史复盘）\n\n" + "\n\n".join(blocks)
