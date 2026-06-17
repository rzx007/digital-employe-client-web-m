"""总管工具 · 技能管理（工作区技能列表 / 详情、内置技能、ClawHub 市场）。

按"职能域"统一组织：
- 工作区技能：list_workspace_skills、get_workspace_skill_detail
- 内置技能：list_builtin_skills、install_builtin_skill（本地 build-in-skills/ 目录）
- 远程市场：search_market_skills、get_market_skill_detail、install_market_skill

共享的内部 helper（如 _get_installed_skill_names、_preview_from_file_map、SKILL.md
预览、文件清单格式化）也放这里；私有以下划线开头，仅供本模块工具函数使用。
"""

from __future__ import annotations

import json
from pathlib import Path

from fastapi import HTTPException
from langchain.tools import ToolRuntime
from langchain_core.tools import tool
from sqlalchemy.orm import Session

from src.service.agent.orchestrator.runtime import (
    get_db,
    get_user_id,
    get_workspace_id,
    resolve_workspace_id,
)
from src.service.agent.orchestrator.tools._helpers import (
    MARKET_SKILL_DETAIL_MAX,
    MARKET_SKILL_SEARCH_LIMIT,
    SKILL_MARKET_URL,
    reset_market_detail_count,
    resolve_conv_id,
    take_market_detail_slot,
)
from src.service.employee_service import EmployeeService
from src.service.local_skill_service import LocalSkillService
from src.service.skillsmp_service import SkillsMpError, SkillsMpService


# ---------------------------------------------------------------------------
# 共享内部 helper
# ---------------------------------------------------------------------------


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


def _preview_skill_md(content: str | None, *, max_lines: int = 40) -> str:
    if not content or not content.strip():
        return "（未包含 SKILL.md 预览）"
    lines = content.splitlines()
    preview = "\n".join(lines[:max_lines])
    if len(lines) > max_lines:
        preview += f"\n...（共 {len(lines)} 行，仅显示前 {max_lines} 行）"
    return preview


def _format_skill_file_list(files: list[str], *, max_names: int = 12) -> str:
    if not files:
        return "（无文件清单）"
    shown = files[:max_names]
    lines = [f"- {name}" for name in shown]
    if len(files) > max_names:
        lines.append(f"... 还有 {len(files) - max_names} 个文件")
    return "\n".join(lines)


def _format_skill_assignees(
    assignees: list[dict[str, int | str]],
) -> str:
    if not assignees:
        return "尚未分配给任何员工（以本段为准）。"
    lines = ["已分配给以下员工："]
    for item in assignees:
        eid = item.get("employee_id")
        name = item.get("employee_name") or f"员工#{eid}"
        lines.append(f"- {name} (employee_id={eid})")
    lines.append("可直接 create_orchestration_plan 委派给上述员工，无需再问用户是否分配。")
    return "\n".join(lines)


def _find_workspace_skill_name_by_local_id(
    workspace_id: int, local_id: int
) -> str | None:
    for item in LocalSkillService.list_local_skills(workspace_id):
        if item.get("localId") == local_id:
            name = str(item.get("skillName") or "").strip()
            return name or None
    return None


def format_workspace_skills_list(
    workspace_id: int,
    *,
    compact: bool = False,
    db: Session | None = None,
) -> list[dict]:
    """builtin + workspace 本地技能，与招聘/员工配置使用同一套 localId。"""
    items: list[dict] = []
    for item in LocalSkillService.list_local_skills(workspace_id):
        local_id = item.get("localId")
        if local_id is None:
            continue
        skill_name = str(item.get("skillName") or "")
        description = (item.get("description") or "").strip()
        zh_raw = item.get("displayNameZh")
        display_zh = (
            zh_raw.strip()
            if isinstance(zh_raw, str) and zh_raw.strip()
            else skill_name
        )
        assignees: list[dict[str, int | str]] | None = None
        if db is not None:
            assignees = EmployeeService.list_skill_assignees(
                db,
                user_id=get_user_id(),
                skill_name=skill_name,
                local_id=int(local_id),
            )
        if compact:
            entry: dict = {
                "id": int(local_id),
                "name": skill_name,
                "display_name_zh": display_zh,
                "source": "builtin" if item.get("isBuiltin") else "workspace",
            }
            if assignees is not None:
                entry["assigned_employees"] = assignees
            items.append(entry)
            continue
        summary = (item.get("recruitSummary") or description).strip()
        if not summary:
            summary = LocalSkillService.build_recruit_summary(description, skill_name)
        items.append(
            {
                "id": int(local_id),
                "name": skill_name,
                "display_name_zh": display_zh,
                "description": description or summary,
                "summary": summary,
                "source": "builtin" if item.get("isBuiltin") else "workspace",
            }
        )
    return items


# ---------------------------------------------------------------------------
# 工作区技能
# ---------------------------------------------------------------------------


@tool
def list_workspace_skills() -> str:
    """列出当前工作空间可分配给数字员工的本地技能库（含 skill id）。

    在 update_employee / hire_employee 需要 skill_ids 时先调用本工具；
    返回的 id 为负整数 localId（如 -101），须原样传入 skill_ids JSON 数组。
    技能库为空时 total=0，仍可录用/更新无技能员工（skill_ids="[]"）。
    """
    workspace_id = get_workspace_id()
    db = get_db()
    skills = format_workspace_skills_list(workspace_id, compact=True, db=db)
    payload = {
        "type": "workspace_skills",
        "workspace_id": workspace_id,
        "total": len(skills),
        "skills": skills,
        "hint": (
            "为员工分配技能：update_employee(employee_id, skill_ids=\"[-100, 11]\");"
            "负整数=本地已安装技能 localId；正整数=企业远程技能 id（无需先安装）。"
            "清空技能：skill_ids=\"[]\"。localId 来自 list_workspace_skills；市场技能安装后同样用 localId。"
            "每项 skills[].assigned_employees 为已分配员工；详情见 get_workspace_skill_detail。"
            "禁止在未查 assigned_employees / 员工表前声称「未分配给任何人」。"
        ),
    }
    return json.dumps(payload, ensure_ascii=False, indent=2)


@tool
def get_workspace_skill_detail(
    skill_name: str | None = None,
    local_id: int | None = None,
) -> str:
    """预览工作区已安装本地技能的 SKILL.md（只读，不安装不修改）。

    list_workspace_skills 列出的技能须用本工具查看详情；
    **禁止**用 read_file 猜测 orchestrator_skills 或磁盘绝对路径。

    Args:
        skill_name: 技能目录名，如 data-querys（与 list_workspace_skills 的 name 一致）
        local_id: list_workspace_skills 返回的 localId（负整数）
    """
    workspace_id = get_workspace_id()
    resolved_name: str | None = None

    if skill_name and skill_name.strip():
        resolved_name = skill_name.strip()
    elif local_id is not None:
        resolved_name = _find_workspace_skill_name_by_local_id(
            workspace_id, int(local_id)
        )
        if not resolved_name:
            return (
                f"错误：未找到 localId={local_id} 的工作区技能。"
                "请先 list_workspace_skills 核对 id。"
            )
    else:
        return "错误：请提供 skill_name 或 local_id 之一。"

    try:
        detail = LocalSkillService.get_local_skill_detail(
            resolved_name, workspace_id
        )
    except HTTPException as exc:
        detail_msg = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
        return f"错误：{detail_msg}"

    skill_name_for_lookup = str(detail.get("skillName") or resolved_name)
    lid = detail.get("localId")
    display_zh = detail.get("displayNameZh") or skill_name_for_lookup
    source = "builtin" if detail.get("isBuiltin") else "workspace"
    files = detail.get("files") or []
    preview = _preview_skill_md(detail.get("skillMdContent"))
    file_list = _format_skill_file_list(files)

    assignees = EmployeeService.list_skill_assignees(
        get_db(),
        user_id=get_user_id(),
        skill_name=skill_name_for_lookup,
        local_id=int(lid) if lid is not None else None,
    )
    assignee_block = _format_skill_assignees(assignees)

    lid_line = f"localId: {lid}\n" if lid is not None else ""
    return (
        f"📄 工作区技能 name={skill_name_for_lookup}\n"
        f"显示名: {display_zh}\n"
        f"{lid_line}"
        f"来源: {source}\n"
        f"\n--- 分配情况 ---\n{assignee_block}\n"
        f"\n--- 文件清单 ---\n{file_list}\n"
        f"\n--- SKILL.md 预览 ---\n{preview}\n"
        f"\n---\n"
        "若尚未分配：update_employee(employee_id, skill_ids=\"[<localId>]\")。"
        "禁止用 read_file 读取本技能磁盘路径。"
    )


MAX_SKILL_DELETE_BATCH = 20


def _delete_one_workspace_skill(
    db: Session, workspace_id: int, skill_name: str
) -> dict:
    """删除单个工作区本地技能（先解绑员工再删目录），与技能市场删除逻辑一致。

    返回 {"ok": True, "skill_name": ..., "unassigned": n} 或
    {"ok": False, "skill_name": ..., "error": ...}。内置技能不可删。
    """
    name = (skill_name or "").strip()
    if not name:
        return {"ok": False, "skill_name": skill_name, "error": "技能名为空"}

    normalized = LocalSkillService._normalize_skill_name(name)
    skill_dir = LocalSkillService._skill_dir(normalized, workspace_id)
    if not skill_dir.is_dir():
        return {
            "ok": False,
            "skill_name": normalized,
            "error": "未找到可删除的工作区技能（可能仅为内置技能或名称不存在）",
        }

    meta = LocalSkillService._read_meta(skill_dir)
    local_id = LocalSkillService._parse_local_id(meta.get("localId"))

    unassigned = EmployeeService.unassign_local_skill_from_assignees(
        db,
        user_id=get_user_id(),
        skill_name=normalized,
        local_id=local_id,
    )
    try:
        LocalSkillService.delete_workspace_skill(normalized, workspace_id)
    except HTTPException as exc:
        db.rollback()
        detail = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
        return {"ok": False, "skill_name": normalized, "error": detail}
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        return {"ok": False, "skill_name": normalized, "error": str(exc)}

    db.commit()
    return {"ok": True, "skill_name": normalized, "unassigned": unassigned}


@tool
def delete_workspace_skill(skill_name: str) -> str:
    """删除单个工作区本地技能（物理删除技能目录，并自动解除已分配员工的绑定）。

    仅删 1 个技能时使用；2 个及以上必须用 delete_workspace_skills_batch。
    只能删本地/已安装技能，**内置技能不可删**。删除前建议 list_workspace_skills 核对。
    与技能市场的删除逻辑一致：先解绑员工、再删目录，不可撤销。

    Args:
        skill_name: 技能目录名（与 list_workspace_skills 返回的 name 一致）
    """
    workspace_id = get_workspace_id()
    db = get_db()
    result = _delete_one_workspace_skill(db, workspace_id, skill_name)
    if not result.get("ok"):
        return f"错误：删除技能「{result['skill_name']}」失败 — {result['error']}"
    unassigned = result.get("unassigned") or 0
    suffix = f"，已同步解除 {unassigned} 名员工的绑定" if unassigned else ""
    return f"✅ 已删除工作区技能「{result['skill_name']}」{suffix}。"


@tool
def delete_workspace_skills_batch(skill_names: str) -> str:
    """批量删除多个工作区本地技能（一次调用，逐个删除并解绑员工）。

    当用户要求删除 2 个及以上技能时使用本工具，不要在同一轮多次 delete_workspace_skill。
    只能删本地/已安装技能，**内置技能不可删**。逐个独立处理，部分失败不影响其余。
    与技能市场的删除逻辑一致：先解绑员工、再删目录，不可撤销。

    参数 skill_names: JSON 字符串数组，例如 "[\"data-querys\", \"ppt-maker\"]"
    """
    workspace_id = get_workspace_id()

    try:
        parsed = json.loads(skill_names)
    except json.JSONDecodeError as exc:
        return f"错误：skill_names 不是合法的 JSON 数组: {exc}"

    if not isinstance(parsed, list):
        return "错误：skill_names 必须为 JSON 数组。"
    if len(parsed) == 0:
        return "错误：skill_names 不能为空。"
    if len(parsed) > MAX_SKILL_DELETE_BATCH:
        return f"错误：单次最多删除 {MAX_SKILL_DELETE_BATCH} 个技能。"

    names: list[str] = []
    for i, raw in enumerate(parsed):
        name = str(raw or "").strip()
        if not name:
            return f"错误：skill_names[{i}] 为空。"
        names.append(name)

    db = get_db()
    ok_lines: list[str] = []
    fail_lines: list[str] = []
    for name in names:
        result = _delete_one_workspace_skill(db, workspace_id, name)
        if result.get("ok"):
            unassigned = result.get("unassigned") or 0
            suffix = f"（解绑 {unassigned} 名员工）" if unassigned else ""
            ok_lines.append(f"- {result['skill_name']} ✅{suffix}")
        else:
            fail_lines.append(f"- {result['skill_name']} ❌ {result['error']}")

    parts = [f"批量删除技能：成功 {len(ok_lines)} 个，失败 {len(fail_lines)} 个。"]
    if ok_lines:
        parts.append("已删除：\n" + "\n".join(ok_lines))
    if fail_lines:
        parts.append("失败：\n" + "\n".join(fail_lines))
    return "\n\n".join(parts)


# ---------------------------------------------------------------------------
# 内置技能（build-in-skills/）
# ---------------------------------------------------------------------------


@tool
def list_builtin_skills(query: str = "") -> str:
    """列出安装包自带的内置技能（build-in-skills），按名称/描述过滤。

    优先 search_market_skills 搜索 ClawHub 技能市场；无合适结果时再查内置技能。
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


# ---------------------------------------------------------------------------
# ClawHub 远程市场
# ---------------------------------------------------------------------------


@tool
def search_market_skills(
    query: str,
    runtime: ToolRuntime[None, None] = None,
) -> str:
    """从 ClawHub 镜像技能市场搜索可安装技能（无需登录，离线模式也可用）。

    每次搜索最多返回 3 个结果；预览详情最多 3 个（get_market_skill_detail）。
    安装前先用 get_market_skill_detail(skill_slug) 预览，确认后 install_market_skill(skill_slug)。

    Args:
        query: 搜索关键词（如「标书」「测试」「ppt」），必填
    """
    q = query.strip()
    if not q:
        return (
            f"请提供搜索关键词，例如 search_market_skills(\"ppt\")。\n"
            f"也可在浏览器打开 {SKILL_MARKET_URL} 浏览全部技能。"
        )

    reset_market_detail_count(resolve_conv_id(runtime))

    try:
        data = SkillsMpService.search(q, limit=MARKET_SKILL_SEARCH_LIMIT)
    except SkillsMpError as exc:
        return f"错误：{exc}"

    skills = data.get("skills") if isinstance(data, dict) else None
    if not isinstance(skills, list):
        return "错误：技能市场搜索响应格式异常。"

    skills = [item for item in skills if isinstance(item, dict)]
    installed = _get_installed_skill_names(resolve_workspace_id(runtime))

    lines = [
        f"技能市场：{SKILL_MARKET_URL}",
        f"搜索结果（「{q}」）：",
        "",
    ]

    if not skills:
        lines.append(
            f"未找到匹配技能。建议在浏览器打开 {SKILL_MARKET_URL} 浏览，或换关键词再搜。"
        )
        return "\n".join(lines)

    for item in skills:
        slug = str(item.get("slug") or item.get("id") or "")
        name = str(item.get("name") or slug)
        desc = str(item.get("description") or "")[:100]
        skill_url = str(item.get("skillUrl") or f"{SKILL_MARKET_URL}/{slug}")
        status = "已安装" if name in installed else "可安装"
        lines.append(f"- slug={slug}")
        lines.append(f"  名称: {name} [{status}]")
        if desc:
            lines.append(f"  描述: {desc}")
        lines.append(f"  页面: {skill_url}")

    lines.extend(
        [
            "",
            f"说明：每次搜索最多 {MARKET_SKILL_SEARCH_LIMIT} 条；"
            f"预览详情最多 {MARKET_SKILL_DETAIL_MAX} 个（请逐个预览，勿并行批量拉取）。",
            "预览: get_market_skill_detail(skill_slug)",
            "安装: install_market_skill(skill_slug)",
            "slug 为字符串（如 autoreview、ppt），不是 localId。",
        ]
    )
    return "\n".join(lines)


@tool
def get_market_skill_detail(
    skill_slug: str,
    runtime: ToolRuntime[None, None] = None,
) -> str:
    """预览 ClawHub 镜像技能市场中的某个技能详情（不安装）。

    详情接口已内联返回 SKILL.md，无需绕 GitHub，预览很快。
    每轮搜索后最多预览 3 个技能；请勿并行连续调用超过 3 次。
    确认符合需求后再调用 install_market_skill(skill_slug) 安装到本机工作区。

    Args:
        skill_slug: search_market_skills 返回的 slug 字符串
    """
    slug = skill_slug.strip()
    if not slug:
        return "错误：skill_slug 不能为空。"

    limit_msg = take_market_detail_slot(resolve_conv_id(runtime))
    if limit_msg:
        return limit_msg

    try:
        detail = SkillsMpService.get_skill(slug)
    except SkillsMpError as exc:
        return f"错误：获取技能详情失败 — {exc}"

    name = detail.get("name") or "?"
    author = detail.get("author") or ""
    desc = detail.get("description") or "无"
    version = detail.get("version")
    skill_url = detail.get("skillUrl") or f"{SKILL_MARKET_URL}/{slug}"

    preview = _preview_skill_md(detail.get("skillMd"))
    files = detail.get("files") if isinstance(detail.get("files"), list) else []
    file_list = _format_skill_file_list([str(f) for f in files])

    author_line = f"名称: {name} (作者: {author})\n" if author else f"名称: {name}\n"
    version_line = f"版本: {version}\n" if version else ""

    return (
        f"📄 技能 slug={slug}\n"
        f"{author_line}"
        f"{version_line}"
        f"描述: {desc}\n"
        f"页面: {skill_url}\n"
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
    """从 ClawHub 镜像技能市场安装技能到当前工作区本地目录（无需登录，离线模式也可用）。

    安装路径：~/.digital-employee/local-skills/<workspace_id>/<skill_name>/
    安装后调用 list_workspace_skills 获取 localId，再 update_employee 分配给员工。

    Args:
        skill_slug: search_market_skills 或 get_market_skill_detail 返回的 slug 字符串
        overwrite: 是否覆盖已安装的同名技能（默认 False）
    """
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
        f"来源: ClawHub (slug={slug})\n"
        f"路径: {result['path']}\n"
        f"下一步: list_workspace_skills → update_employee 分配 skill_ids"
    )
