# 工作区外目录写授权（HITL + 三档授权 + 会话模式）— 设计 spec

- 日期：2026-06-20
- 分支：feat/orchestrator-centric
- 关联：[2026-06-11-employee-workspace-model-design.md](2026-06-11-employee-workspace-model-design.md)（工作区模型）、[2026-06-17-multi-workspace-user-level-design.md](2026-06-17-multi-workspace-user-level-design.md)（多工作区）、shell 硬底线 `command_safety`（灾难命令永不执行，commit 2c9ed202）

## 1. 背景与目标

总管/员工的文件工具当前**可写本机任意绝对路径**，无工作区边界、无授权流程。[`_validate_path_allow_physical`](../../../apps/server/src/service/agent/compatible_filesystem_middleware.py) 直接放行 Windows 盘符 / Unix 绝对路径；唯一的沙箱检查 [`_resolve_safe_path`](../../../apps/server/src/service/resource_service.py) 只在**资源管理器读列表/读内容**时生效，碰不到 Agent 工具层。HITL 仅覆盖 6 个数据库删除工具（[`destructive_hitl`](../../../apps/server/src/service/agent/destructive_hitl.py)），shell 仅有灾难命令硬底线。

**结论：当前没有"工作区外目录写授权"机制——员工给个绝对路径就能写/删工作区外任意目录，无校验、无弹窗。**

### 目标
为**写/删类文件工具**补一道工作区边界闸：当目标路径在工作区外且未授权时，挂 HITL 让用户当场决定，授权按用户所选档位（仅这次 / 本会话 / 永久）记录，后续命中即放行。同时提供会话级"全放行 / 严格禁止"模式开关（输入框切换 + 卡片一键升级）。

### 非目标
- **不**拦读（`read_file`/`ls` 等读工作区外目录静默放行——低风险）。
- **不**纳入 `shell_execute`（命令字符串无法可靠判读写/抽路径，继续靠 `command_safety` 硬底线兜底）。
- **不**改 [`_validate_path_allow_physical`](../../../apps/server/src/service/agent/compatible_filesystem_middleware.py) 的物理路径放行语义（它无工具身份/会话上下文，不是强制点）。
- **不**做工作区设置页 UI 管理"已授权目录列表"（本期只留 service，UI 留口子）。

## 2. 核心决策（已与用户对齐）

| 维度 | 决策 |
|------|------|
| 授权粒度 | 用户在卡片上**当场三选一**：仅这次 / 本会话 / 永久 |
| 读写分级 | **读放行，只拦写/删** |
| shell | 本期不纳入，靠硬底线兜底 |
| auto 模式 | 用户可"放行所有"——收编为会话级三态模式 `ask/auto/deny` |
| 授权归属 | 永久授权挂 `workspace_id`（非 user_id），同用户不同工作区互不串 |
| 授权匹配 | 按**目录前缀**——授权父目录则其子路径一并放行 |

## 3. 架构

```
write_file / edit_file / 删除工具  ──执行前守卫──▶ guard_external_write(ctx, target, tool)
read_file / ls / shell             ──不经守卫──▶ 原样放行
                                                     │
                  is_outside_workspace(target, roots)?  ──否(工作区内)──▶ 放行
                                                     │是
                          is_granted(ctx, target)?  ──是(已授权/auto)──▶ 放行
                          会话 mode == deny?         ──是──▶ ToolRejected(直拒,不弹)
                                                     │否(需询问)
                          interrupt({type:"external_dir_authorization", path, tool, choices})
                                                     │ 前端卡片 → 用户选择 → resume
                          record_grant(ctx, target, decision)  →  原始写操作继续
                          decision==reject → ToolRejected
```

并存关系：本特性的 `interrupt()` 是**按参数动态抛**（写到工作区外才触发），与现有 `interrupt_on` 的**按工具名静态挂**（澄清/删除）互不冲突、各走各的 resume 通路。

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
| 仅这次 | 不存 | 放行当前单次操作 |
| 本会话（某目录） | `Conversation.session_flags` JSON 加 `granted_dirs: [path,...]` | 本对话 |
| 永久（某目录） | 新表 `workspace_authorized_dir` | 该工作区永久 |
| 会话模式 | `Conversation.session_flags.external_dir_mode ∈ {ask, auto, deny}` | 本对话 |
| 工作区 auto 默认 | `Workspace.auto_grant_external_dirs`（布尔列，默认 False） | 永久，作新会话 mode 初值 |

`is_granted(ctx, target)` 短路检查链（命中任一即放行）：
1. `Workspace.auto_grant_external_dirs == True` → 放行
2. 会话 `external_dir_mode == "auto"` → 放行
3. 永久表 `workspace_authorized_dir` 有前缀覆盖 target 的目录 → 放行
4. 会话 `granted_dirs` 有前缀覆盖 target 的目录 → 放行
5. 否则未授权（守卫据会话 mode 决定：`deny` 直拒 / `ask` 弹卡片）

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

### 4.4 动态拦截与 resume — 守卫接入

在 [compatible_filesystem_middleware](../../../apps/server/src/service/agent/compatible_filesystem_middleware.py) 给 **write_file / edit_file / 删除** 工具的执行函数套守卫（read_file/ls 不套、shell 不套）：

```python
def guard_external_write(ctx, target, tool_name):
    roots = collect_workspace_roots(ctx)
    if not is_outside_workspace(target, roots):
        return                                   # 工作区内,放行
    if is_granted(ctx, target):
        return                                   # 已授权/auto,放行
    if session_mode(ctx) == "deny":
        raise ToolRejected(f"严格模式:拒绝写入工作区外目录 {target}")
    decision = interrupt({                        # langgraph 动态 interrupt
        "type": "external_dir_authorization",
        "path": target, "tool": tool_name,
        "choices": ["once", "session", "permanent", "auto_session", "reject"],
    })
    if decision == "reject":
        raise ToolRejected(f"用户拒绝了对工作区外目录 {target} 的写入")
    record_grant(ctx, target, decision)           # 按档位:落永久表/写 granted_dirs/切 mode=auto
```

**resume 语义**：`interrupt()` 挂起后,用户在前端选完,graph 从该工具节点**重跑**,`interrupt()` 第二次返回所选值;此时 `record_grant` 已落地,原始写继续执行。守卫**幂等**:重跑时 `is_granted` 已 True（或 interrupt 返回决策),不会二次弹窗。`reject` → 工具返回拒绝串,Agent 据此另谋出路。`record_grant` 把 target 取**父目录**写入（前缀授权,见 §4.2 匹配）。

### 4.5 前端 — 授权卡片 + 输入框模式切换

**授权卡片**：复用现有 HITL 卡片 interrupt→渲染→resume 通路（澄清/删除审批已有），新增卡片类型 `external_dir_authorization`：展示「员工 X 想写入工作区外目录 `D:\...`」+ 五按钮（仅这次 / 本会话 / 永久 / 放行所有(本会话) / 拒绝），点击以所选值 resume 当前 run。「放行所有(本会话)」= 把会话 mode 切到 `auto`。

**输入框模式切换（会话级三态）**：composer 区加「工作区外目录」模式开关（沿用现有输入框模式开关样式）：

| 模式 | 含义 | 落地 |
|------|------|------|
| 询问（默认） | 越界写弹卡片 | 正常流 |
| 全放行 / auto | 越界写全部静默放行 | `external_dir_mode=auto` |
| 严格禁止 | 越界写一律直拒、不弹 | `external_dir_mode=deny` |

卡片「放行所有」按钮与输入框开关共用同一状态 `session_flags.external_dir_mode`。具体前端组件文件在写实施计划时定位（本节锁定"复用 HITL 卡片基建 + 加卡片类型 + 输入框三态开关"）。

## 5. 改动面

- **后端新增**：`models/workspace_authorized_dir.py`；`service/agent/path_authorization.py`（边界判定 + 守卫 + is_granted + record_grant）；`service/authorized_dir_service.py`（list/grant/revoke）；`destructive_hitl` 风格的 session_flags 辅助（mode/granted_dirs 读写）。
- **后端改动**：`Workspace` 加列 `auto_grant_external_dirs` + 迁移；`compatible_filesystem_middleware` write/edit/delete 工具接守卫；orchestrator/employee 把 workspace_id + 各允许根传入守卫上下文。
- **前端**：新增 `external_dir_authorization` HITL 卡片类型；输入框「工作区外目录」三态模式开关 + 对应 session_flags 读写 API 接线。
- **数据库**：新表 + Workspace 一列,需迁移。

## 6. 测试策略

- **单元**：`is_outside_workspace`（resolve 吃 `../`/符号链接/子路径/相对路径绕过;多允许根命中）；`is_granted` 五级短路优先级；目录前缀匹配（授权父→子文件放行,授权 `foo` 不放行 `foobar`）。
- **service**：永久表 grant/revoke/list（唯一约束、跨 workspace 隔离）；session_flags `granted_dirs` 与 `external_dir_mode` 读写。
- **集成**：越界写 → 抛 interrupt;按 once/session/permanent/auto_session resume → 各档位授权落地 + 操作继续;reject → 操作中止(ToolRejected);同目录/子目录二次写 → 不再 interrupt;mode=deny → 直拒不弹;mode=auto / 工作区 auto 列 → 静默放行。
- **回归底线**：工作区内写**永不**弹;读工作区外**永不**弹;shell 越界**不**走此闸(仅硬底线)。
- **基线**：后端现有 5 failed 基线不新增（参 MEMORY 全套 686 passed 基线）;前端 typecheck/vitest 基线不破。

## 7. 风险

- **动态 interrupt 可行性**：需确认 deepagents/langgraph 在工具执行函数内调 `interrupt()` 并支持重跑 resume（现有 HITL 用声明式 `interrupt_on`,本特性首次用函数内动态 interrupt）。实施期先写最小 spike 验证 resume 重跑语义,不通则退到"守卫返回特殊待授权结果 + 上层挂 interrupt_on"的迂回方案。
- **collect_workspace_roots 上下文可达性**：守卫需在工具执行上下文拿到 workspace_id + 各允许根。employee/orchestrator 初始化已注入这些路径（[employee.py](../../../apps/server/src/service/agent/employee.py) 的 ARTIFACTS_DIR/WORKSPACE_DIR 等环境变量 + shell backend 入参）,实施期核对工具运行时能否取到 workspace_id（落 session_flags/永久表都需要它）。
- **前缀匹配跨平台**：Windows 路径大小写不敏感 + 盘符。前缀比较走 `Path.resolve()` 后用 `is_relative_to`,避免裸字符串前缀的 `foo`/`foobar` 误判。
- **resume 幂等**：守卫重跑必须不二次弹窗——靠 record_grant 先落地保证 is_granted 第二跑为 True;若决策是 once（不落存储）,则靠 interrupt 第二次直接返回 once 放行,不再进入弹窗分支。

## 8. 验收对照

员工试图写工作区外目录 `D:\其他项目\x.txt` → 弹授权卡片(五选项);选「永久」→ 落 `workspace_authorized_dir`,此后该工作区任意会话写该目录及子路径不再弹;选「本会话」→ 仅本对话不再弹;选「仅这次」→ 下次再弹;选「放行所有」或输入框切 auto → 本会话所有越界写静默放行;输入框切「严格禁止」→ 越界写直接被拒不弹。工作区内写、读工作区外、shell 越界——均不受影响。
