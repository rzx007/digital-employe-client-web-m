from __future__ import annotations

from pathlib import Path


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
