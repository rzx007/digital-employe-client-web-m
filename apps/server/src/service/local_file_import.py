"""跨平台本机绝对路径识别与导入会话 /uploads/。

deepagents 的 read_file 经 validate_path 拒绝 Windows 盘符路径（C:\\...）；
Unix 绝对路径（/Users/...）虽可能通过校验，但在 virtual_mode 下会被
错误解析到 artifacts/ 子目录。本模块在 Agent 读文件前，将用户消息或
import_local_file 工具给出的本机路径复制到 /uploads/，使 read_file 走
统一的虚拟路径。
"""

from __future__ import annotations

import logging
import os
import re
from pathlib import Path

logger = logging.getLogger(__name__)

# 与 CompositeBackend 路由前缀保持一致；用于区分「虚拟路径」与「本机绝对路径」
VIRTUAL_PREFIXES = (
    "/artifacts/",
    "/uploads/",
    "/skills/",
    "/skills-draft/",
    "/memories/",
    "/agent/",
    "/conversation_history/",
)

# 单条用户消息最多自动导入条数，防止恶意/误粘贴大量路径拖慢发消息
MAX_IMPORTS_PER_MESSAGE = 5

# 三端路径提取 regex（引号内路径优先，见 extract_host_paths_from_text）
_WINDOWS_PATH_RE = re.compile(r"[A-Za-z]:[\\/][^\s\"']+")
_UNIX_PATH_RE = re.compile(
    # 常见本机目录前缀；刻意不匹配 /artifacts 等虚拟路径（已由 is_virtual_path 过滤）
    r"/(?:Users|home|tmp|var|opt|mnt)[^\s\"']*",
)
_QUOTED_PATH_RE = re.compile(
    r"""(['"])(?:(?=(\\?))\2.)*?(?:/|\\)[^'"]*?\1"""
)


def is_virtual_path(path: str) -> bool:
    normalized = path.replace("\\", "/")
    return any(normalized.startswith(prefix) for prefix in VIRTUAL_PREFIXES)


def normalize_host_path(raw: str) -> Path:
    """本机路径规范化：去引号 → 展开 ~ 与环境变量 → resolve 为绝对路径。"""
    cleaned = raw.strip().strip("'\"")
    expanded = os.path.expandvars(os.path.expanduser(cleaned))
    return Path(expanded).resolve()


def is_host_absolute_path(path: str) -> bool:
    """判断是否为本机绝对路径（非 Agent 虚拟路径）。

    Windows 上 Path('/Users/...').is_absolute() 为 False，因此显式识别
    盘符路径与以 / 开头的 Unix 风格路径，保证跨平台文本提取一致。
    """
    if is_virtual_path(path):
        return False
    cleaned = path.strip().strip("'\"")
    if re.match(r"^[a-zA-Z]:", cleaned):
        return True
    if cleaned.startswith("/"):
        return True
    try:
        return Path(cleaned).expanduser().is_absolute()
    except (OSError, ValueError):
        return False


def is_safe_to_import(resolved: Path) -> bool:
    """仅允许导入已存在的普通文件；软链需 resolve 后仍为文件（防目录链逃逸）。"""
    try:
        if not resolved.exists():
            return False
        if not resolved.is_file():
            return False
        if resolved.is_symlink():
            target = resolved.resolve()
            if not target.is_file():
                return False
        return True
    except OSError:
        return False


def try_map_to_existing_virtual(
    root_path: str,
    conversation_id: int,
    resolved: Path,
) -> str | None:
    """若文件已在当前会话 uploads/ 或 artifacts/ 下，返回虚拟路径并免复制。"""
    conversation_dir = (Path(root_path) / str(conversation_id)).resolve()
    try:
        rel = resolved.resolve().relative_to(conversation_dir)
    except ValueError:
        return None

    parts = rel.parts
    if len(parts) < 2:
        return None

    top, rest = parts[0], parts[1:]
    if top == "uploads" and rest:
        return "/uploads/" + "/".join(rest)
    if top == "artifacts" and rest:
        return "/artifacts/" + "/".join(rest)
    return None


def extract_host_paths_from_text(text: str) -> list[str]:
    """从用户消息提取本机绝对路径候选（去重保序）。

    提取顺序：
    1. 引号包裹路径（含空格的文件名）
    2. Windows / Unix regex 扫描全文
    3. 按空白分词，仅保留磁盘上真实存在的文件（减少误匹配）
    """
    if not text or not text.strip():
        return []

    seen: set[str] = set()
    ordered: list[str] = []

    def add_candidate(raw: str) -> None:
        # 剥掉句末中文/英文标点，避免 "C:\\a.md。" 无法 resolve
        candidate = raw.strip().rstrip(".,;:!?)】》")
        if not candidate or is_virtual_path(candidate):
            return
        key = candidate.replace("\\", "/")
        if key in seen:
            return
        if is_host_absolute_path(candidate):
            seen.add(key)
            ordered.append(candidate)

    for match in _QUOTED_PATH_RE.finditer(text):
        quoted = match.group(0)
        inner = quoted[1:-1]
        if "/" in inner or re.search(r"[A-Za-z]:[\\/]", inner):
            add_candidate(inner)

    for match in _WINDOWS_PATH_RE.finditer(text):
        add_candidate(match.group(0))

    for match in _UNIX_PATH_RE.finditer(text):
        add_candidate(match.group(0))

    for token in text.split():
        token = token.strip().strip("'\"")
        if not token or is_virtual_path(token):
            continue
        try:
            resolved = normalize_host_path(token)
            # 必须 is_file()：regex 可能匹配到尚不存在的路径，留给后续 import 报错
            if resolved.is_file() and is_host_absolute_path(token):
                key = str(resolved).replace("\\", "/")
                if key not in seen:
                    seen.add(key)
                    ordered.append(token)
        except (OSError, ValueError):
            continue

    return ordered


def import_paths_from_message(
    root_path: str,
    conversation_id: int,
    text: str,
) -> list[dict[str, str]]:
    """扫描消息中的本机路径并导入 uploads/，供 chat_service 合并进 extra_meta.files。

    由 stream_conversation_answer 在注入 [上传的文件] 上下文前调用；
    单条失败仅记日志，不阻断发消息与其余文件导入。
    """
    # 延迟导入，避免与 resource_service 顶层循环依赖
    from src.service.resource_service import ResourceService

    candidates = extract_host_paths_from_text(text)
    if len(candidates) > MAX_IMPORTS_PER_MESSAGE:
        logger.warning(
            "本机路径导入超过上限 %s，仅处理前 %s 条",
            MAX_IMPORTS_PER_MESSAGE,
            MAX_IMPORTS_PER_MESSAGE,
        )
        candidates = candidates[:MAX_IMPORTS_PER_MESSAGE]

    results: list[dict[str, str]] = []
    for raw in candidates:
        try:
            resolved = normalize_host_path(raw)
        except (OSError, ValueError) as exc:
            logger.warning("无法解析本机路径 %s: %s", raw, exc)
            continue

        if not is_safe_to_import(resolved):
            logger.warning("跳过不安全或不可读路径: %s", raw)
            continue

        outcome = ResourceService.import_local_file(
            root_path,
            conversation_id,
            resolved,
        )
        if isinstance(outcome, str):
            logger.warning("导入本机文件失败 %s: %s", raw, outcome)
            continue

        logger.info(
            "已导入本机文件 %s -> %s (conv=%s)",
            resolved,
            outcome.path,
            conversation_id,
        )
        results.append(
            {
                "path": outcome.path,
                "name": outcome.name,
                "source": str(resolved),
            }
        )

    return results
