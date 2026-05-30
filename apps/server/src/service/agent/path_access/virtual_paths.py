"""虚拟前缀常量与映射（纯函数，不依赖 deepagents）。

虚拟路径（如 /artifacts/、/skills/）是 CompositeBackend 的路由前缀，与本机物理
路径相互独立。即便框架日后原生放行本机绝对路径，这里的前缀映射仍是产品逻辑，需保留。
"""

from __future__ import annotations

from pathlib import Path

VIRTUAL_PREFIXES: tuple[str, ...] = (
    "/artifacts/",
    "/uploads/",
    "/skills/",
    "/skills-draft/",
    "/memories/",
    "/agent/",
    "/conversation_history/",
)


def is_virtual_path(path: str) -> bool:
    """是否为 CompositeBackend 路由的虚拟路径（含仅前缀本身，如 "/skills"）。"""
    normalized = path.replace("\\", "/")
    for prefix in VIRTUAL_PREFIXES:
        if normalized == prefix.rstrip("/") or normalized.startswith(prefix):
            return True
    return False


def map_virtual_token(
    token: str,
    *,
    skills_root: Path,
    draft_root: Path | None = None,
    memories_root: Path | None = None,
    artifacts_root: Path | None = None,
    uploads_root: Path | None = None,
) -> str:
    """将单个虚拟路径 token 映射为真实物理路径；非虚拟 token 原样返回。"""
    normalized = token.replace("\\", "/")

    if artifacts_root is not None:
        if normalized == "/artifacts":
            return str(artifacts_root)
        if normalized.startswith("/artifacts/"):
            suffix = normalized[len("/artifacts/") :]
            return str((artifacts_root / suffix).resolve())

    if uploads_root is not None:
        if normalized == "/uploads":
            return str(uploads_root)
        if normalized.startswith("/uploads/"):
            suffix = normalized[len("/uploads/") :]
            return str((uploads_root / suffix).resolve())

    if normalized == "/skills":
        return str(skills_root)
    if normalized.startswith("/skills/"):
        suffix = normalized[len("/skills/") :]
        return str((skills_root / suffix).resolve())

    if memories_root is not None:
        if normalized == "/memories":
            return str(memories_root)
        if normalized.startswith("/memories/"):
            suffix = normalized[len("/memories/") :]
            return str((memories_root / suffix).resolve())

    if draft_root is not None:
        if normalized == "/skills-draft":
            return str(draft_root)
        if normalized.startswith("/skills-draft/"):
            suffix = normalized[len("/skills-draft/") :]
            return str((draft_root / suffix).resolve())

    return token
