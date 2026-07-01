from __future__ import annotations

import json
import os
import re
from pathlib import Path

from sqlalchemy.orm import Session

from src.models.conversation import Conversation
from src.service.agent.destructive_hitl import parse_session_flags


def is_outside_workspace(target: str, roots: list[Path]) -> bool:
    """target.resolve() 不在任何 root 之下 → True(越界)。
    resolve 吃掉 ../ 与符号链接，杜绝绕过；用 is_relative_to 避免 foo/foobar 前缀误判。"""
    try:
        t = Path(target).resolve()
    except (OSError, ValueError):
        return True
    for root in roots:
        try:
            if t.is_relative_to(Path(root).resolve()):
                return False
        except (OSError, ValueError):
            continue
    return True


def collect_workspace_roots(root_path: str, skills_root=None, memories_dir=None) -> list[Path]:
    """工作区合法写入根集合(按 spike 结论)。
    Path(root_path) 整根涵盖 artifacts/uploads/skills-draft/每会话目录;
    skills_root、memories_dir 在独立另一棵树,必须显式加入。"""
    roots = [Path(root_path)]
    if skills_root:
        roots.append(Path(skills_root))
    if memories_dir:
        roots.append(Path(memories_dir))
    return roots


# ---------------------------------------------------------------------------
# 会话级工作区外目录写授权辅助
# ---------------------------------------------------------------------------

VALID_MODES = {"ask", "auto", "deny"}


def _save_flags(db: Session, conversation_id: int, flags: dict) -> None:
    """将 flags 写回 Conversation.session_flags 并 commit。"""
    conv = db.get(Conversation, conversation_id)
    if not conv:
        return
    conv.session_flags = json.dumps(flags, ensure_ascii=False) if flags else None
    db.add(conv)
    db.commit()


def get_external_dir_mode(db: Session, conversation_id: int) -> str:
    """返回会话的外部目录模式：ask(默认)/auto/deny。"""
    conv = db.get(Conversation, conversation_id)
    flags = parse_session_flags(conv.session_flags if conv else None)
    mode = flags.get("external_dir_mode")
    return mode if mode in VALID_MODES else "ask"


def set_external_dir_mode(db: Session, conversation_id: int, mode: str) -> None:
    """设置会话外部目录模式。mode 必须是 ask/auto/deny，否则抛 ValueError。"""
    if mode not in VALID_MODES:
        raise ValueError(f"invalid mode: {mode!r}，合法值：{VALID_MODES}")
    conv = db.get(Conversation, conversation_id)
    if not conv:
        return
    flags = parse_session_flags(conv.session_flags)
    flags["external_dir_mode"] = mode
    _save_flags(db, conversation_id, flags)


def _add_dir_to_list(db: Session, conversation_id: int, key: str, path: str) -> None:
    """向 session_flags[key]（列表）追加 path，已存在则跳过。"""
    conv = db.get(Conversation, conversation_id)
    if not conv:
        return
    flags = parse_session_flags(conv.session_flags)
    lst: list[str] = flags.get(key, [])
    if path not in lst:
        lst.append(path)
    flags[key] = lst
    _save_flags(db, conversation_id, flags)


def add_session_granted_dir(db: Session, conversation_id: int, path: str) -> None:
    """向本会话永久授权目录列表追加 path。"""
    _add_dir_to_list(db, conversation_id, "granted_dirs", path)


def get_session_granted_dirs(db: Session, conversation_id: int) -> list[str]:
    """返回本会话永久授权目录列表。"""
    conv = db.get(Conversation, conversation_id)
    return parse_session_flags(conv.session_flags if conv else None).get("granted_dirs", [])


def add_once_granted_dir(db: Session, conversation_id: int, path: str) -> None:
    """向一次性令牌列表追加 path（使用一次后即移除）。"""
    _add_dir_to_list(db, conversation_id, "once_granted_dirs", path)


def consume_once_granted_dir(db: Session, conversation_id: int, target: str) -> bool:
    """target 命中某 once 令牌前缀 → 移除该令牌并返回 True；否则返回 False。"""
    conv = db.get(Conversation, conversation_id)
    if not conv:
        return False
    flags = parse_session_flags(conv.session_flags)
    tokens: list[str] = flags.get("once_granted_dirs", [])
    try:
        t = Path(target).resolve()
    except (OSError, ValueError):
        return False
    for tok in list(tokens):
        try:
            if t.is_relative_to(Path(tok).resolve()):
                tokens.remove(tok)
                flags["once_granted_dirs"] = tokens
                _save_flags(db, conversation_id, flags)
                return True
        except (OSError, ValueError):
            continue
    return False


# ---------------------------------------------------------------------------
# 工作区外目录写授权：6级短路检查链 + 按scope落地
# ---------------------------------------------------------------------------

from src.models.workspace import Workspace  # noqa: E402
from src.service.authorized_dir_service import grant_dir, list_authorized_dirs  # noqa: E402


def _prefix_hit(target: str, dirs: list[str]) -> bool:
    """target 落在 dirs 中任一目录前缀之下 → True。"""
    try:
        t = Path(target).resolve()
    except (OSError, ValueError):
        return False
    for d in dirs:
        try:
            if t.is_relative_to(Path(d).resolve()):
                return True
        except (OSError, ValueError):
            continue
    return False


def is_granted(db: Session, workspace_id: int, conversation_id: int, target: str) -> bool:
    """6级短路：命中任一即放行（返回 True）。
    1. workspace.auto_grant_external_dirs
    2. 会话 external_dir_mode == "auto"
    3. 工作区永久授权目录前缀
    4. 会话级授权目录前缀
    5. 一次性令牌前缀（命中即消费）
    6. 以上均未命中 → False
    """
    ws = db.get(Workspace, workspace_id)
    if ws and ws.auto_grant_external_dirs:
        return True
    if get_external_dir_mode(db, conversation_id) == "auto":
        return True
    if _prefix_hit(target, list_authorized_dirs(db, workspace_id)):
        return True
    if _prefix_hit(target, get_session_granted_dirs(db, conversation_id)):
        return True
    if consume_once_granted_dir(db, conversation_id, target):
        return True
    return False


def guard_external_write(target: str, *, db: Session, workspace_id: int, conversation_id: int, roots: list[Path]) -> str | None:
    """返回 None=放行写；返回错误提示串=挡回(调用方转 error ToolMessage)。

    判定顺序：
    1. 目标在工作区内 → None（放行）
    2. 已授权（is_granted 含 auto/永久/会话/once）→ None
    3. 会话 mode == "deny" → 返回"严格模式拒绝"串
    4. 否则（ask 且未授权）→ 返回"请先调用 request_external_dir_access 申请授权"串
    """
    if not is_outside_workspace(target, roots):
        return None
    if is_granted(db, workspace_id, conversation_id, target):
        return None
    if get_external_dir_mode(db, conversation_id) == "deny":
        return (
            f"严格模式（目录模式=严禁）：拒绝写入工作区外目录 {target}；"
            "不可申请授权，请改用工作区内路径或请用户切换模式。"
        )
    parent = str(Path(target).resolve().parent)
    return (
        f"目标 {target} 在工作区外且未授权。请先调用 "
        f'request_external_dir_access(path="{parent}") 申请授权，获批后再写。'
    )


# ---------------------------------------------------------------------------
# Shell 命令启发式路径抽取 + shell 写守卫
# ---------------------------------------------------------------------------

# 各类绝对路径候选正则（保守：字符类排除空白与 "<>|;,，
# 避免误吸选项/管道/重定向符；排 ; , 是为防把 C:\x;%PATH% 这类 list 变量整段吞成一个路径）
_WIN_DRIVE_RE = re.compile(
    r"""[A-Za-z]:[/\\][^\s"'<>|;,]*""",
)
_UNC_RE = re.compile(
    r"""\\\\[^\s"'<>|;,]+""",
)
_ENV_VAR_RE = re.compile(
    r"""%[^%\s]+%[/\\][^\s"'<>|;,]*""",
)
_TILDE_RE = re.compile(
    r"""~[/\\][^\s"'<>|;,]*""",
)
_UNIX_ABS_RE = re.compile(
    # 负后向断言：前面不是盘符字母+冒号（避免把 C:/foo 中的 /foo 单独抽出）
    r"""(?<![A-Za-z]:)/[^\s"'<>|;,]+""",
)
# URL（scheme://...）：抽路径前先整段剥掉——URL 是网络读、绝非本地写。
# 否则 https:// 里的 ``s:`` 会被 _WIN_DRIVE_RE 误当盘符 ``s:\``、//host/path
# 被 _UNIX_ABS_RE 误当绝对路径，导致 curl/wget/pip 等安装命令被误拦。
_URL_RE = re.compile(
    r"""\b[A-Za-z][A-Za-z0-9+.\-]*://[^\s"'<>|]+""",
)

_ALL_PATTERNS = [_WIN_DRIVE_RE, _UNC_RE, _ENV_VAR_RE, _TILDE_RE, _UNIX_ABS_RE]


def _strip_quotes(s: str) -> str:
    """去掉两端的成对单/双引号。"""
    if len(s) >= 2 and s[0] == s[-1] and s[0] in ('"', "'"):
        return s[1:-1]
    return s


def _expand_and_validate(raw: str) -> str | None:
    """对单个原始候选 token：剥引号 → 展开 %VAR%/$VAR/~ → 校验仍是绝对路径。
    返回展开后的绝对路径；非法（含未解析变量 / 非绝对 / 展开成 list 变量）→ None。
    """
    token = _strip_quotes(raw.strip())
    expanded = os.path.expandvars(token)
    expanded = os.path.expanduser(expanded)
    # 展开后仍含未解析的 %...%，说明变量不存在，丢弃
    if re.search(r"%[^%]+%", expanded):
        return None
    # list 变量（如 %PATH% 展开）：含 os.pathsep 或多个盘符 → 不是单一路径，丢弃
    if os.pathsep in expanded:
        return None
    if len(re.findall(r"[A-Za-z]:[/\\]", expanded)) > 1:
        return None
    # 只保留展开后仍是绝对路径的候选
    if not (os.path.isabs(expanded) or re.match(r"[A-Za-z]:[/\\]", expanded)):
        return None
    return expanded


def _collect_abs_paths(text: str) -> list[str]:
    """从一段文本里收集绝对路径候选（URL 剥离 + 各正则匹配 + 展开校验 + 去重）。
    不做任何写/读上下文判断——纯 token 抽取，供上层按需筛选。
    """
    text = _URL_RE.sub(lambda m: " " * len(m.group(0)), text)

    non_unix_patterns = [_WIN_DRIVE_RE, _UNC_RE, _ENV_VAR_RE, _TILDE_RE]
    non_unix_spans: list[tuple[int, int]] = []
    raw_candidates: list[str] = []

    for pat in non_unix_patterns:
        for m in pat.finditer(text):
            non_unix_spans.append(m.span())
            raw_candidates.append(m.group(0))

    for m in _UNIX_ABS_RE.finditer(text):
        start, _end = m.span()
        overlaps = any(ns <= start < ne for ns, ne in non_unix_spans)
        if not overlaps:
            raw_candidates.append(m.group(0))

    seen: set[str] = set()
    result: list[str] = []
    for raw in raw_candidates:
        expanded = _expand_and_validate(raw)
        if expanded is not None and expanded not in seen:
            seen.add(expanded)
            result.append(expanded)
    return result


# 写/删命令集（命令名去路径/扩展名后小写比对）
_WRITE_COMMANDS = {
    # bash/unix
    "cp", "mv", "rm", "mkdir", "tee", "dd", "ln", "touch", "install",
    "rmdir", "truncate",
    # cmd
    "copy", "move", "del", "erase", "md", "rd", "xcopy", "robocopy",
    "ren", "rename",
    # powershell
    "out-file", "set-content", "add-content", "new-item", "remove-item",
    "copy-item", "move-item", "rename-item", "ni", "ri",
}

# 重定向算子：> >> 1> 2> &> >&（后面跟写目标路径 token）
_REDIRECT_RE = re.compile(
    r"""(?:\d*>>?|&>|>&)\s*("[^"]*"|'[^']*'|[^\s"'<>|;&]+)""",
)

# 子命令分隔符：&& || | ; & 换行
_SUBCMD_SPLIT_RE = re.compile(r"""(?:&&|\|\||[|;&\n])""")


def _command_name(token: str) -> str:
    """取命令名：去引号 → 去路径目录 → 去扩展名 → 小写。"""
    t = _strip_quotes(token.strip())
    t = t.replace("\\", "/")
    base = t.rsplit("/", 1)[-1]
    if "." in base:
        base = base.rsplit(".", 1)[0]
    return base.lower()


def extract_write_target_paths(command: str) -> list[str]:
    """收窄到「写上下文」的绝对路径抽取：只抽写/删操作的目标绝对路径。

    两类来源：
    1. 重定向目标：``> >> 1> 2> &> >&`` 后面跟的路径 token（动机案例：echo > 桌面\\x）。
    2. 写/删命令的绝对路径参数：按 ``&& || | ; & 换行`` 拆子命令，对每个子命令取首个
       token 作命令名（去路径/扩展名/小写），若在写/删命令集里，则抽该子命令内的绝对路径。

    写上下文之外的绝对路径（curl/pip/set PATH/cat/dir/URL/list 变量）一律不抽。
    保守：宁可漏拦个别冷门写法，也不误拦合法命令。
    """
    # URL 整段剥成等长空格（保持后续 span 对齐），避免 https:// 被误当盘符/绝对路径
    sanitized = _URL_RE.sub(lambda m: " " * len(m.group(0)), command)

    targets: list[str] = []
    seen: set[str] = set()

    def _add(paths: list[str]) -> None:
        for p in paths:
            if p not in seen:
                seen.add(p)
                targets.append(p)

    # 来源 1：重定向目标
    for m in _REDIRECT_RE.finditer(sanitized):
        _add(_collect_abs_paths(m.group(1)))

    # 来源 2：写/删命令子命令的绝对路径参数
    for sub in _SUBCMD_SPLIT_RE.split(sanitized):
        sub = sub.strip()
        if not sub:
            continue
        first = sub.split(None, 1)[0]
        if _command_name(first) in _WRITE_COMMANDS:
            _add(_collect_abs_paths(sub))

    return targets


def extract_command_paths(command: str) -> list[str]:
    """启发式从 shell 命令字符串里抽取绝对路径，展开环境变量/~，去重返回。

    保守策略：宁可漏抽混淆路径，也不把非路径误报成路径。
    覆盖形态：
    - Windows 盘符路径：``C:\\foo``  ``D:/bar``
    - UNC 路径：``\\\\server\\share``
    - 含环境变量：``%USERPROFILE%\\Desktop\\x.txt``
    - 波浪线展开：``~/Documents/x.txt``
    - Unix 绝对路径：``/etc/passwd``
    已知会漏：极度混淆（base64 编码路径、变量拼接等）。
    已知限制：若 Windows 盘符路径含正斜杠（如 C:/foo），同一字符串中的子路径
    （/foo）可能同时被 Unix 正则抽取，后处理阶段会过滤掉此类子串。
    """
    # 第零阶段：把 URL（http(s)/ftp/git+ssh/file...）整段抹成等长空格——URL 是网络
    # 读取目标、不是本地写路径；不剥掉则 https:// 的 s: 会被当盘符、//host 被当绝对路径。
    # 用等长空格替换以保持后续 span 位置对齐。
    command = _URL_RE.sub(lambda m: " " * len(m.group(0)), command)

    # 第一阶段：用各模式收集原始候选 token（连同在命令字符串中的位置）
    # 非 Unix 模式优先抽取（盘符、UNC、环境变量、~），Unix 模式最后
    non_unix_patterns = [_WIN_DRIVE_RE, _UNC_RE, _ENV_VAR_RE, _TILDE_RE]
    non_unix_spans: list[tuple[int, int]] = []
    raw_candidates: list[str] = []

    for pat in non_unix_patterns:
        for m in pat.finditer(command):
            non_unix_spans.append(m.span())
            raw_candidates.append(m.group(0))

    # Unix 绝对路径：只收集不在非 Unix 匹配范围内的（避免把盘符路径的 /子路径 重复抽取）
    for m in _UNIX_ABS_RE.finditer(command):
        start, end = m.span()
        # 若该 match 的开始位置落在任何非 Unix 匹配的范围之内，跳过
        overlaps = any(ns <= start < ne for ns, ne in non_unix_spans)
        if not overlaps:
            raw_candidates.append(m.group(0))

    # 第二阶段：展开、过滤、去重
    seen: set[str] = set()
    result: list[str] = []
    for raw in raw_candidates:
        token = _strip_quotes(raw.strip())
        # 展开 %VAR% 与 $VAR 环境变量、~ 用户目录
        expanded = os.path.expandvars(token)
        expanded = os.path.expanduser(expanded)
        # 若展开后仍含未解析的 %...%，说明变量不存在，丢弃（无意义路径）
        if re.search(r"%[^%]+%", expanded):
            continue
        # 只保留展开后仍是绝对路径的候选
        if not (os.path.isabs(expanded) or re.match(r"[A-Za-z]:[/\\]", expanded)):
            continue
        if expanded not in seen:
            seen.add(expanded)
            result.append(expanded)
    return result


def guard_external_shell(
    command: str,
    *,
    db: Session,
    workspace_id: int,
    conversation_id: int,
    roots: list[Path],
) -> str | None:
    """扫命令的「写目标」绝对路径，任一在工作区外且未授权 → 返回挡回提示串；否则 None。

    收窄到写上下文（重定向目标 + 写/删命令参数），不再扫命令里所有绝对路径，
    消除 curl/pip/set PATH/cat 等读取或安装命令的误拦。
    """
    for p in extract_write_target_paths(command):
        reason = guard_external_write(
            p,
            db=db,
            workspace_id=workspace_id,
            conversation_id=conversation_id,
            roots=roots,
        )
        if reason is not None:
            return reason
    return None


def record_grant(db: Session, workspace_id: int, conversation_id: int, path: str, scope: str) -> None:
    """按 scope 把授权落到对应存储。
    scope 取值：permanent / session / auto / once；其他值抛 ValueError。
    """
    if scope not in {"permanent", "session", "auto", "once"}:
        raise ValueError(f"invalid scope: {scope!r}，合法值：permanent/session/auto/once")
    parent = str(Path(path).resolve())
    if scope == "permanent":
        grant_dir(db, workspace_id, parent)
    elif scope == "session":
        add_session_granted_dir(db, conversation_id, parent)
    elif scope == "auto":
        set_external_dir_mode(db, conversation_id, "auto")
    elif scope == "once":
        add_once_granted_dir(db, conversation_id, parent)
