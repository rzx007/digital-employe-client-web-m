# 工作区外目录写授权（HITL + 三档授权 + 会话模式）— 设计 spec

- 日期：2026-06-20
- 分支：feat/orchestrator-centric
- 关联：[2026-06-11-employee-workspace-model-design.md](2026-06-11-employee-workspace-model-design.md)（工作区模型）、[2026-06-17-multi-workspace-user-level-design.md](2026-06-17-multi-workspace-user-level-design.md)（多工作区）、shell 硬底线 `command_safety`（灾难命令永不执行，commit 2c9ed202）

## 1. 背景与目标

总管/员工的文件工具当前**可写本机任意绝对路径**，无工作区边界、无授权流程。[`_validate_path_allow_physical`](../../../apps/server/src/service/agent/compatible_filesystem_middleware.py) 直接放行 Windows 盘符 / Unix 绝对路径；唯一的沙箱检查 [`_resolve_safe_path`](../../../apps/server/src/service/resource_service.py) 只在**资源管理器读列表/读内容**时生效，碰不到 Agent 工具层。HITL 仅覆盖 6 个数据库删除工具（[`destructive_hitl`](../../../apps/server/src/service/agent/destructive_hitl.py)），shell 仅有灾难命令硬底线。

**结论：当前没有"工作区外目录写授权"机制——员工给个绝对路径就能写工作区外任意目录，无校验、无弹窗（文件删除经 shell `rm`，另由硬底线兜底）。**

### 目标
为**写类文件工具 `write_file` / `edit_file`**补一道工作区边界闸：当目标路径在工作区外且未授权时，挂 HITL 让用户当场决定，授权按用户所选档位（仅这次 / 本会话 / 永久）记录，后续命中即放行。同时提供会话级"全放行 / 严格禁止"模式开关（输入框切换 + 卡片一键升级）。

> **范围澄清（评审纠正）**：agent 工具层**没有独立的"删除文件"工具**——文件删除只能经 `shell_execute` 的 `rm` 实现。`destructive_hitl` 的 6 个删除工具均为**数据库**删除（员工/任务/技能），非文件删除。故本闸实际只覆盖 `write_file` / `edit_file`；工作区外**文件删除**随 shell 一并不纳入本闸，由 `command_safety` 硬底线兜底（用户"只拦写/删"的意图在文件工具层等价于"拦写")。

### 非目标
- **不**拦读（`read_file`/`ls` 等读工作区外目录静默放行——低风险）。
- **不**纳入 `shell_execute`（命令字符串无法可靠判读写/抽路径，继续靠 `command_safety` 硬底线兜底）；**文件删除走 shell，故同样不纳入本闸**。
- **不**改 [`_validate_path_allow_physical`](../../../apps/server/src/service/agent/compatible_filesystem_middleware.py) 的物理路径放行语义（它无工具身份/会话上下文，不是强制点）。
- **不**做工作区设置页 UI 管理"已授权目录列表"（本期只留 service，UI 留口子）。

### 已知限制（决策存档）
- **后台子任务（`enable_hitl=False`）暂不挂此守卫，工作区外写放行**：派单/返工路径无人值守、无法弹 HITL 卡片授权；强挂守卫只会使任务持续被挡回、卡住，可用性代价不可接受。当前决策：`employee.py` 的 `get_agent` 中，只有 `enable_hitl=True`（真人会话）+ 有 `conversation_id` + 有 `workspace_id` 时才注册守卫并挂 `request_external_dir_access` 工具；后台路径不注册，守卫 fail-open 放行。待后续实现"后台预授权（任务创建时锁定允许目录列表）"或"异步审批"机制后再收紧。

## 2. 核心决策（已与用户对齐）

| 维度 | 决策 |
|------|------|
| 授权粒度 | 用户在卡片上**当场三选一**：仅这次 / 本会话 / 永久 |
| 读写分级 | **读放行，只拦写**（文件工具层无 delete 工具，"删"经 shell→见 §1 范围澄清） |
| shell | 本期不纳入，靠硬底线兜底 |
| auto 模式 | 用户可"放行所有"——收编为会话级三态模式 `ask/auto/deny` |
| 授权归属 | 永久授权挂 `workspace_id`（非 user_id），同用户不同工作区互不串 |
| 授权匹配 | 按**目录前缀**——授权父目录则其子路径一并放行 |

## 3. 架构

**关键决策（评审后定）**：本仓库现有 HITL **全是声明式 `interrupt_on` + `/approve` resume**，无任何动态 `interrupt()` 先例；且 `write_file`/`edit_file` 是 deepagents 基类工具、运行时 `ToolRuntime` 拿不到 conversation_id。故**不在 write_file 内抛动态 interrupt**，改用"**写守卫返回提示 + 显式请求工具走声明式 interrupt_on**"——复用唯一验证过的 HITL 链路。

```
write_file / edit_file  ──守卫 guard_external_write(target)──▶ 返回 reason 串 | None
read_file / ls / shell  ──不经守卫──▶ 原样放行
        │
   is_outside_workspace(target, roots)? ──否(工作区内)──▶ None,放行写
        │是
   is_granted(ctx, target)?  ──是(已授权/auto)──▶ None,放行写
        │否
   mode == deny ──是──▶ 返回 error ToolMessage("严格模式:拒绝写工作区外")
        │否(ask 且未授权)
   返回 error ToolMessage:"目标在工作区外,请先调用 request_external_dir_access(path) 申请授权"
        │
   Agent 据此改调 ▶ request_external_dir_access(path, reason)   ← 此工具登记在 interrupt_on
        │ interrupt_on 挂起 → 前端授权卡片(5选项) → POST /approve 回灌决策+scope
   approve handler 按 scope 记授权(once/session/permanent/auto) → 工具返回"已授权 {path}"
        │ reject → 工具返回"用户拒绝授权 {path}"
   Agent 重试 write_file ▶ 此时 is_granted=True → 写入成功
```

`request_external_dir_access` 走的链路与 `submit_clarifying_questions` / `delete_*` **完全相同**（声明式 `interrupt_on` + `/approve`），零动态 interrupt。即便 Agent 不主动调请求工具，write 也会被守卫持续挡回（返回 error 直到授权），稳健兜底。

## 4. 设计

### 4.1 边界判定 — `path_authorization.py`（新建，`apps/server/src/service/agent/`）

工作区"内"是**一组允许根**，非单一目录（员工合法写入根有多个，见 [employee.py](../../../apps/server/src/service/agent/employee.py) 注入的 artifacts/uploads/skills/workspace 共享）：

```python
def collect_workspace_roots(ctx) -> list[Path]:
    """当前会话合法写入根：artifacts_dir, uploads_dir, skills_root,
    workspace_shared_dir, product_root。从 shell/agent 上下文取已注入的路径。"""

def is_outside_workspace(target: str, roots: list[Path]) -> bool:
    """target.resolve() 不在任何 root 之下 → True。复用 _resolve_safe_path 的
    relative_to 判定。一律 resolve()：吃掉 ../、符号链接、相对路径,杜绝绕过。"""
```

### 4.2 授权存储（三档分层 + 检查链）

| 档位/模式 | 存储 | 生命周期 |
|-----------|------|----------|
| 仅这次 | `session_flags.once_granted_dirs: [path]`（一次性令牌） | 被紧接的 write 守卫**消费即删** |
| 本会话（某目录） | `Conversation.session_flags` JSON 加 `granted_dirs: [path,...]` | 本对话 |
| 永久（某目录） | 新表 `workspace_authorized_dir` | 该工作区永久 |
| 会话模式 | `Conversation.session_flags.external_dir_mode ∈ {ask, auto, deny}` | 本对话 |
| 工作区 auto 默认 | `Workspace.auto_grant_external_dirs`（布尔列，默认 False） | 永久，作新会话 mode 初值 |

`is_granted(db, conv_id, target)` 短路检查链（命中任一即放行）：
1. `Workspace.auto_grant_external_dirs == True` → 放行
2. 会话 `external_dir_mode == "auto"` → 放行
3. 永久表 `workspace_authorized_dir` 有前缀覆盖 target 的目录 → 放行
4. 会话 `granted_dirs` 有前缀覆盖 target 的目录 → 放行
5. 会话 `once_granted_dirs` 有前缀覆盖 target 的目录 → 放行**并从令牌列表移除**（一次性）
6. 否则未授权（守卫据会话 mode 决定：`deny` 直拒 / `ask` 返回"请申请"提示）

`session_flags` 的读写完全复用 [destructive_hitl 现成那套](../../../apps/server/src/service/agent/destructive_hitl.py)（`parse_session_flags` / `get_session_flags` / 仿 `set_skip_destructive_hitl` 加 `set_external_dir_mode` / `add_session_granted_dir`）。

### 4.3 数据模型

新建 `apps/server/src/models/workspace_authorized_dir.py`：

```python
class WorkspaceAuthorizedDir(Base):
    __tablename__ = "workspace_authorized_dir"
    id: int                      # 主键
    workspace_id: int            # FK → workspace.id
    path: str                    # resolve 后绝对目录,最长 1024(与 root_path 对齐)
    created_at: datetime         # 审计
    # UniqueConstraint(workspace_id, path)
```

`Workspace` 模型加列 `auto_grant_external_dirs: bool = False`。

配套 `authorized_dir_service`（轻量）：`list_authorized_dirs / grant_dir / revoke_dir`，给将来设置页留口（本期无 UI）。

### 4.4 写守卫 + 显式请求工具（声明式 HITL）

**(a) 自定义 write_file / edit_file（仿现有 read_file 覆盖）**：[compatible_filesystem_middleware](../../../apps/server/src/service/agent/compatible_filesystem_middleware.py) 已覆盖 read_file（line ~612 `StructuredTool.from_function`），write_file/edit_file 仍走 deepagents 基类。本特性**比照 read_file 覆盖 write_file/edit_file**，在写入前插守卫。守卫需 conversation_id + workspace 根 + DB 访问——这些在 [employee.py](../../../apps/server/src/service/agent/employee.py) 构造 agent 时已知，**经闭包注入**（conversation_id、`resolve_workspace_dirs` 结果、DB session 工厂）；授权状态在**每次写调用时实时查 DB**（用户中途授权后重试写要能看到最新授权）。

```python
def guard_external_write(target, *, conv_id, roots, db_factory) -> str | None:
    """返回 None=放行；返回错误提示串=挡回(调用方转 error ToolMessage,不抛异常)。"""
    if not is_outside_workspace(target, roots):
        return None                                # 工作区内,放行
    with db_factory() as db:
        if is_granted(db, conv_id, target):
            return None                            # 已授权/auto,放行
        mode = get_external_dir_mode(db, conv_id)
    if mode == "deny":
        return f"严格模式:拒绝写入工作区外目录 {target}"
    return (f"目标 {target} 在工作区外且未授权。请先调用 "
            f"request_external_dir_access(path=\"{父目录(target)}\") 申请授权,获批后再写。")

# write_file 工具包装层:
reason = guard_external_write(target, conv_id=..., roots=..., db_factory=...)
if reason is not None:
    return ToolMessage(status="error", content=reason, tool_call_id=...)
# else 执行原始基类写
```

**(b) 新工具 `request_external_dir_access(path: str, reason: str = "")`**：注册进 `interrupt_on`（仿 [destructive_hitl](../../../apps/server/src/service/agent/destructive_hitl.py) 的 `DESTRUCTIVE_HITL_INTERRUPT_ON`），`allowed_decisions` 含 approve/reject。Agent 调它 → `interrupt_on` 挂起 → 前端授权卡片（§4.5）。工具体在 resume 后返回 `"已授权 {path}"` 或 `"用户拒绝授权 {path}"`，Agent 据此重试写或放弃。

**(c) 授权落地在 `/approve` handler（仿 destructive `skip_for_conversation`）**：前端 approve 时除 `decisions` 外带 `options.external_dir = {path, scope}`，`scope ∈ {once, session, permanent, auto}`。[chat_service.approve_trigger](../../../apps/server/src/service/chat_service.py) 在 resume `request_external_dir_access` 前按 scope 记授权：`permanent`→写 `workspace_authorized_dir` 表；`session`→`add_session_granted_dir`；`auto`→`set_external_dir_mode(auto)`；`once`→不持久化（仅本次 approve 放行，靠 §4.2 的本次授权令牌或直接放行该工具回合后由 Agent 重试时——见下）。`reject`→`decisions=[{type:"reject"}]`，不记授权。

**`once`（仅这次）落地细节**：因写发生在 Agent **重试 write_file 时**（在 request 工具回合之后），`once` 不能"零持久化"——否则重试时 `is_granted` 为 False 又被挡。故 `once` 记一个**最小生命周期令牌**：写入 `session_flags.once_granted_dirs`（一次性，被 write 守卫消费后即移除）。即"放行紧接其后的那一次写"，不残留。`record_grant` 统一把 path 取**父目录**（前缀授权,见 §4.2）。

### 4.5 前端 — 授权卡片 + 输入框模式切换

**授权卡片**：复用现有 HITL 卡片渲染+resume 通路。卡片类型 `external_dir_authorization` 由工具名 `request_external_dir_access` 经 [hitlKindFromToolType](../../../apps/web/src/lib/chat/hitl/kind.ts) 映射（仿 destructive-delete 的识别，需在 [constants.ts](../../../apps/web/src/lib/chat/hitl/constants.ts) 登记 tool 名 + [block-render-map.tsx](../../../apps/web/src/components/chat/message-blocks/block-render-map.tsx) 加分发分支 + [chat-composer-area.tsx](../../../apps/web/src/components/chat/panel/chat-composer-area.tsx) 加 blocksComposer 条件）。新建卡片组件 `external-dir-auth-card.tsx`（仿 [destructive-delete-confirm-card.tsx](../../../apps/web/src/components/chat/message-blocks/destructive-delete-confirm-card.tsx)）：从工具入参 `block.input.path` 取目标路径，展示「员工想写入工作区外目录 `D:\...`」+ 五按钮 → 各按钮调 [approveHitl](../../../apps/web/src/api/conversation.ts) 带 `options.external_dir = {path, scope}`：

| 按钮 | decisions | options.external_dir.scope |
|------|-----------|---------------------------|
| 仅这次 | `[{type:"approve"}]` | `once` |
| 本会话 | `[{type:"approve"}]` | `session` |
| 永久 | `[{type:"approve"}]` | `permanent` |
| 放行所有(本会话) | `[{type:"approve"}]` | `auto` |
| 拒绝 | `[{type:"reject", message:"用户拒绝授权"}]` | — |

「放行所有(本会话)」= scope `auto` → 后端 `set_external_dir_mode(auto)`，与输入框药丸同一状态实时一致。

**输入框模式药丸（会话级三态，Claude-Code 式）**：在 composer 底部工具栏放一个**模式药丸 + 下拉菜单**，仿 Claude Code 的 Mode 选择器交互（药丸显示当前模式名，点开下拉列三项、当前项打勾，可选键盘快捷键）。**只管"工作区外目录"这一件事**，借的是"药丸 + 下拉 + 勾选"的交互形态，非照搬 Claude Code 全部权限模式。

- **落点**：[`chat-prompt-input.tsx`](../../../apps/web/src/components/chat-prompt-input/chat-prompt-input.tsx) 的 `PromptInputFooter` **左侧** `PromptInputTools` 组（紧挨附件菜单 `PromptInputActionMenu` / 上下文预算 `ContextBudgetIndicator`）。新增组件 `ExternalDirModePill`。

| 模式 | 药丸显示 | 含义 | 落地 |
|------|---------|------|------|
| 询问（默认） | 「目录·询问」 | 越界写弹卡片 | `external_dir_mode=ask` |
| 全放行 / auto | 「目录·放行」 | 越界写全部静默放行 | `external_dir_mode=auto` |
| 严格禁止 | 「目录·严禁」 | 越界写一律直拒、不弹 | `external_dir_mode=deny` |

- **状态单一来源**：药丸 ↔ 卡片「放行所有」按钮共用同一会话状态 `session_flags.external_dir_mode`；切药丸 = 写该会话 flag，卡片点「放行所有」= 把它切到 `auto`，两处实时一致。
- **API 接线**：新增读/写会话 `external_dir_mode` 的端点（仿 `set_skip_destructive_hitl` 那条会话 flag 写入通路），前端 TanStack Query hook 驱动药丸状态。新会话初值取 `Workspace.auto_grant_external_dirs`（默认 `ask`）。

## 5. 改动面

- **后端新增**：`models/workspace_authorized_dir.py`（新表）；`service/agent/path_authorization.py`（`collect_workspace_roots` + `is_outside_workspace` + `is_granted` + `record_grant` + session_flags 辅助 `get/set_external_dir_mode`、`add_session_granted_dir`、`once_granted_dirs` 读写消费）；`service/authorized_dir_service.py`（list/grant/revoke 永久表）；`request_external_dir_access` 工具 + 其 `interrupt_on` 登记（仿 destructive_hitl）。
- **后端改动**：`Workspace` 加列 `auto_grant_external_dirs`（create_all 自动建，**无 alembic**，模型加列即可，见 §6 注意旧库）；`compatible_filesystem_middleware` 比照 read_file **覆盖 write_file/edit_file** 接守卫（无 delete 文件工具，故不含 delete）；[employee.py](../../../apps/server/src/service/agent/employee.py) 把 conversation_id + workspace 根 + db 工厂注入守卫闭包，并把 `request_external_dir_access` 挂进 agent 工具集与 interrupt_on；[chat_service.approve_trigger](../../../apps/server/src/service/chat_service.py) + [chat_api.py](../../../apps/server/src/api/chat_api.py) 的 `/approve` 加 `external_dir={path,scope}` 处理（按 scope 记授权）；新增写 `external_dir_mode` 的端点（仿 `set_skip_destructive_hitl`）。
- **前端**：HITL `kind` 加 `external_dir_authorization`（[kind.ts](../../../apps/web/src/lib/chat/hitl/kind.ts)/[constants.ts](../../../apps/web/src/lib/chat/hitl/constants.ts) 登记 tool 名）；新建 `external-dir-auth-card.tsx` + [block-render-map.tsx](../../../apps/web/src/components/chat/message-blocks/block-render-map.tsx) 分发 + [chat-composer-area.tsx](../../../apps/web/src/components/chat/panel/chat-composer-area.tsx) blocksComposer；[approveHitl](../../../apps/web/src/api/conversation.ts) options 加 `external_dir`；新增 `ExternalDirModePill`（药丸+下拉，挂 `chat-prompt-input.tsx` 的 `PromptInputFooter` 左侧 `PromptInputTools` 组，用 `@workspace/ui/components/dropdown-menu`）；会话 `external_dir_mode` 读写 hook。
- **数据库**：新表 + Workspace 一列，`Base.metadata.create_all` 启动自动建（[init_db.py](../../../apps/server/src/db/init_db.py)），新表须在 [models/__init__.py](../../../apps/server/src/models/__init__.py) import 以注册。

## 6. 测试策略

- **单元**：`is_outside_workspace`（resolve 吃 `../`/符号链接/子路径/相对路径绕过;多允许根命中）；`is_granted` 五级短路优先级；目录前缀匹配（授权父→子文件放行,授权 `foo` 不放行 `foobar`）。
- **service**：永久表 grant/revoke/list（唯一约束、跨 workspace 隔离）；session_flags `granted_dirs` 与 `external_dir_mode` 读写。
- **守卫单测**：`guard_external_write` 各分支——工作区内→None;已授权→None;mode=deny→"严格"错误串;ask 未授权→"请调用 request_external_dir_access"错误串。`once_granted_dirs` 被消费即移除。
- **请求工具+approve 单测**：`request_external_dir_access` 登记进 interrupt_on;`/approve` 带 `external_dir={path,scope}` 按 scope 各自落地（permanent→表/session→granted_dirs/auto→mode/once→once_granted_dirs/reject→不记）。
- **集成**：越界写 → 守卫返回 error 提示 → Agent 调请求工具 → interrupt_on 挂起 → approve(scope) → 授权落地 → 重试写成功;同目录/子目录二次写 → 守卫直接放行(不再请求);mode=deny → 守卫直拒、不触发请求;mode=auto / 工作区 auto 列 → 守卫静默放行。
- **回归底线**：工作区内写**永不**弹;读工作区外**永不**弹;shell 越界**不**走此闸(仅硬底线)。
- **基线**：后端现有 5 failed 基线不新增（参 MEMORY 全套 686 passed 基线）;前端 typecheck/vitest 基线不破。

## 7. 风险

- **覆盖基类 write_file/edit_file 可行性**：write/edit 是 deepagents `FilesystemMiddleware` 基类工具。本仓库已对 read_file 做过子类覆盖（[compatible_filesystem_middleware](../../../apps/server/src/service/agent/compatible_filesystem_middleware.py) line ~612），故覆盖可行;但 write/edit 的基类函数签名 + 它们调用的 backend 写方法需实施期比照 read_file 精确核对，确保覆盖后写行为不变、仅前插守卫。**Phase 1 先做 spike-lite 验证覆盖写工具 + 守卫能挡回**。
- **守卫内 DB + conversation_id 可达性**：守卫要在工具执行时实时查授权（DB + conv_id）。这些在 [employee.py](../../../apps/server/src/service/agent/employee.py) 构造 agent 时已知，经**闭包注入**（conv_id、`resolve_workspace_dirs` 结果、db session 工厂）。风险点是工具执行上下文内开 DB session 是否安全——spike-lite 一并验证。
- **旧库加列（无 alembic）**：`create_all` **不会**给已存在的 `workspace` 表 ALTER 加 `auto_grant_external_dirs` 列。需在 [init_db.py](../../../apps/server/src/db/init_db.py) 加一次性"列存在性检查 + ALTER TABLE"（仿现有 FTS5 初始化的幂等风格），否则旧库启动会因缺列报错。新表 `workspace_authorized_dir` 则由 create_all 正常新建。
- **Agent 遵从请求流**：靠员工系统提示引导"写工作区外须先 `request_external_dir_access`"。即便 Agent 不调，write 守卫持续返回 error 挡回（兜底稳健），最坏是多一两轮试错。实施期在员工系统提示明确写这条流程。
- **前缀匹配跨平台**：Windows 路径大小写不敏感 + 盘符。前缀比较走 `Path.resolve()` 后用 `is_relative_to`，避免裸字符串前缀的 `foo`/`foobar` 误判。

## 8. 验收对照

员工写工作区外目录 `D:\其他项目\x.txt` → 守卫挡回并提示，员工调 `request_external_dir_access` → 弹授权卡片(五选项)。选「永久」→ 落 `workspace_authorized_dir`，此后该工作区任意会话写该目录及子路径守卫直接放行;选「本会话」→ 仅本对话放行;选「仅这次」→ 仅紧接其后那次写放行、再写又需申请;选「放行所有」或输入框切 auto → 本会话所有越界写静默放行;输入框切「严格禁止」→ 越界写直接被拒、不触发申请。工作区内写、读工作区外、shell 越界——均不受影响。
