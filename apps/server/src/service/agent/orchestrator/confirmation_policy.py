from __future__ import annotations

from typing import Any

# 破坏性/有副作用关键词：单任务即便是 small 档，prompt 或 task_name 命中这些词
# 也强制走确认门——被派员工以 enable_hitl=False 执行，自动放行后这些操作再无 HITL
# 拦截，故宁可误确认、不可误放行。聚焦「明确危险」动词，不含 写入/修改 等过宽词。
_DESTRUCTIVE_KEYWORDS: tuple[str, ...] = (
    # 中文：删除/清理/卸载/格式化
    "删除", "删掉", "删库", "清空", "清除", "卸载", "格式化", "覆盖", "重置",
    # 中文：资金/对外发布/部署等不可逆副作用
    "转账", "汇款", "支付", "付款", "下单", "购买", "退款",
    "发送", "发布", "上线", "部署", "迁移", "重命名", "改名",
    # 命令行：高危 shell
    "rm -", "rm-", "drop ", "drop table", "truncate", "mkfs", "del /",
)


def _task_is_readonly_query(task: dict[str, Any]) -> bool:
    """该单任务是否为「只读/查询类」轻量活：small 档、无破坏性关键词。

    保守判定——任何不确定（缺 output_tier、非 small、命中危险词）都返回 False。
    """
    if (task.get("output_tier") or "").strip().lower() != "small":
        return False
    haystack = f"{task.get('task_name') or ''}\n{task.get('prompt') or ''}".lower()
    for kw in _DESTRUCTIVE_KEYWORDS:
        if kw.lower() in haystack:
            return False
    return True


def compute_requires_confirmation(
    task_list: list[dict[str, Any]], *, has_schedule: bool = False
) -> bool:
    """编排计划是否须用户确认后才执行。

    定时计划（has_schedule=True）一律须确认。
    否则仅当**单个只读/查询类任务**（small 档、无依赖、无破坏性关键词）时免确认，
    由 create_orchestration_plan 直接自动执行。
    """
    if has_schedule:
        return True
    if len(task_list) != 1:
        return True
    task = task_list[0]
    if task.get("depends_on") not in (None, [], ()):
        return True
    return not _task_is_readonly_query(task)
