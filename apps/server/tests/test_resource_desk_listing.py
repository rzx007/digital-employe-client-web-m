"""1C：总管会话 artifact-panel 显示共享桌产物。

NOTE(SP2 Task 2.1)：资源面板的「共享桌产物合并」读路径已随 legacy/desk-merge
读回退一并删除（spec §2「不做双轨读回退」）。SP2 后资源面板只读项目产物根下
的 artifacts/uploads/skills-draft 三桶。

NOTE(SP2 Task 3.1)：`resolve_workspace_context` / `_resolve_employee_id_for_conversation`
已随草稿读侧配平到项目产物根而删除（skill_api 改走 resolve_conversation_product_root），
原覆盖其 desk 重定向行为的两个用例（test_resolve_workspace_context_*）一并移除。
总管/desk 产物落项目根的面板可见性属 Task 3.2，届时再补对应测试。
"""
