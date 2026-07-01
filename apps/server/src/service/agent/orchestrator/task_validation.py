"""编排计划子任务校验（create_orchestration_plan 前置）。"""

from __future__ import annotations

from typing import Any


def validate_orchestration_tasks(task_list: list[dict[str, Any]]) -> str | None:
    """校验子任务列表。通过返回 None，失败返回中文错误说明。"""
    if len(task_list) <= 1:
        return None

    employee_ids: list[int] = []
    for i, task in enumerate(task_list):
        raw_id = task.get("employee_id")
        if raw_id is None:
            return f"错误：子任务 #{i} 缺少 employee_id。"
        try:
            employee_ids.append(int(raw_id))
        except (TypeError, ValueError):
            return f"错误：子任务 #{i} 的 employee_id 无效。"

    if len(set(employee_ids)) == 1:
        emp_id = employee_ids[0]
        return (
            f"错误：所有子任务都指派给同一员工（ID={emp_id}）。"
            "请合并为一条子任务（在 prompt 中写清多步目标，"
            "例如先 read_file($UPLOADS_DIR 下文件) 再 write_file 到产物目录），"
            "或分配给不同员工。子任务拆分仅用于多人协作。"
        )

    return _validate_dependencies(task_list)


def _parse_depends_on(raw: Any) -> list[int]:
    """把 depends_on 解析成下标列表，支持 int / int[] / null（排除 bool）。"""
    if isinstance(raw, bool):
        return []
    if isinstance(raw, int):
        return [raw]
    if isinstance(raw, list):
        return [x for x in raw if isinstance(x, int) and not isinstance(x, bool)]
    return []


def _validate_dependencies(task_list: list[dict[str, Any]]) -> str | None:
    """依赖结构自检：自依赖 / 越界下标 / 成环——任一不合法返回中文错误，否则 None。

    放在 create 前拦截：成环会让调度器永远凑不齐前置而死锁，越界下标会被调度器
    静默丢弃（依赖悄悄失效），都该让总管当场改对，而非埋到执行期。
    """
    n = len(task_list)
    dep_map: dict[int, list[int]] = {}
    for i, task in enumerate(task_list):
        deps = _parse_depends_on(task.get("depends_on"))
        for idx in deps:
            if idx == i:
                return (
                    f"错误：子任务 #{i}「{task.get('task_name') or ''}」依赖了自己"
                    "（自依赖）。depends_on 应填其前置任务的下标，不能指向自身。"
                )
            if idx < 0 or idx >= n:
                return (
                    f"错误：子任务 #{i}「{task.get('task_name') or ''}」的 depends_on "
                    f"下标 {idx} 超出范围（应在 0~{n - 1} 之间，指向计划内的前置任务）。"
                )
        dep_map[i] = deps

    # 成环检测（DFS 三色标记）
    WHITE, GRAY, BLACK = 0, 1, 2
    color = {i: WHITE for i in range(n)}

    def _has_cycle(u: int) -> bool:
        color[u] = GRAY
        for v in dep_map.get(u, []):
            if color[v] == GRAY:
                return True
            if color[v] == WHITE and _has_cycle(v):
                return True
        color[u] = BLACK
        return False

    for i in range(n):
        if color[i] == WHITE and _has_cycle(i):
            return (
                "错误：子任务依赖关系成环（循环依赖），调度器将无法启动任何一环。"
                "请检查各子任务的 depends_on，确保是有向无环（前置→后继单向）的。"
            )

    return None
