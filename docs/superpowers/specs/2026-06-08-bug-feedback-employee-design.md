# BUG 反馈内置员工 — 设计 Spec

- 日期：2026-06-08
- 状态：待评审
- 范围：纯后端 + 一份内置技能；**零前端改动**（除一行 env 注入）。

## 1. 目标与非目标

### 目标
- 新增一个**默认内置数字员工**「问题反馈助手」（chat 进入，像其他内置员工一样出现在员工列表）。
- 员工引导用户说清 BUG，收集**用户正文**，自动附带**环境信息**，**可选**附带本地日志（须用户同意）。
- 提交前出**确认卡片**（HITL），用户点「确认提交」后才上报。
- 上报经本地 `POST /feedback` 端点，**转发到远端公司后台**（`REMOTE_API_BASE_URL + FEEDBACK_PATH`），复用现有 `login_api` 转发范式。

### 非目标（YAGNI）
- 不做前端"反馈"按钮/菜单入口（仅默认员工，聊天进入）。
- 不带会话上下文/不抓取聊天记录。
- 不做本地工单管理/历史查询界面。
- 远端接口尚不存在：本期**只做客户端侧 + 可配置占位**，不实现远端。

## 2. 现状锚点（复用，不新造）
- **内置员工 seed**：`_BUILTIN_SEED_EMPLOYEES`（`apps/server/src/service/employee_service.py:36`）是 `(员工名, (技能名…), 描述)` 列表；`ensure_builtin_seed_employees`（同文件:1194）启动时 seed build-in-skills 到本地，再按 **名+技能集幂等** 建员工。名字不存在即创建 → **已有工作空间下次启动自动补出该员工**。
- **内置技能源**：`apps/server/build-in-skills/<name>/SKILL.md`（如 `env-steward`）；带 frontmatter `name/description`。
- **HITL 提交工具范式**：`apps/server/src/service/agent/document_plan_tool.py` 的 `submit_document_plan`；在 `employee.py:225` 加入 `extra_tools`，并由 `interrupt_on`/`HITL_INTERRUPT_ON`（employee.py:248）挂中断产出确认卡片。
- **远端转发范式（实测）**：`apps/server/src/api/login_api.py` 路由用**直接 `httpx.post`** 转发到一个**预拼好的 `*_url`**（如 `get_settings().login_url`），并在路由装饰器加 `dependencies=[Depends(require_capability("remote_login"))]`（`src/core/deps.py`）做**离线门控**；用户 token 经 `_forward_token_headers` 走 **`token` 请求头**（非 `Authorization`）。配置侧：`*_PATH` kv（如 `LOGIN_PATH`，默认 `/yc/login`）经 `join_base_and_path(platform_base_url, path)`（`config.py:62`）拼成 `*_url` 字段（`config.py:487`）。kv 取自 SQLite `config_kvs` 表，非 OS 环境变量。
- **不使用** `remote_gateway.sync_post`：现有 `api/` 路由无一处用它，feedback 沿用上面的 login 范式以保持一致。
- **日志位置**：`~/.digital-employee/logs/{app,error}.log`（`config.py:34` `get_default_logs_dir()`、`logging_setup.py`）。
- **离线标志/版本**：`OFFLINE_MODE` 已注入后端 env（`backend-process.ts`）；`APP_VERSION` 当前后端拿不到，需注入。

## 3. 架构总览

```
用户 ── chat ──▶ 「问题反馈助手」员工(SKILL.md 人设)
                     │  收集 正文；询问是否附日志
                     ▼
            submit_bug_report 工具(HITL 挂中断)
                     │  产出确认卡片(标题/描述/环境摘要/是否附日志)
                     ▼  用户点「确认提交」→ resume
            feedback_service.submit_feedback()
                     │  组装载荷(正文 + 自动环境 + 可选日志截断)
                     ▼
            POST /feedback (api/feedback_api.py, require_capability 离线门控)
                     │  httpx.post(feedback_url, headers={"token": …})
                     ▼
            feedback_url = REMOTE_API_BASE_URL + FEEDBACK_PATH  (你的远端后台)
```

## 4. 组件设计（各单元：职责 / 接口 / 依赖）

### 4.1 内置员工技能 `build-in-skills/bug-reporter/SKILL.md`
- **职责**：人设「问题反馈助手」。工作流：
  1. 引导用户说清：标题、问题描述、复现步骤、期望 vs 实际。
  2. 显式询问"是否附带最近运行日志帮助定位？"（默认否）。
  3. 调 `submit_bug_report`，把结构化字段 + `include_logs` 传入。
  4. 工具产出确认卡片；用户确认后上报；向用户回执（成功/工单号/失败原因）。
- **接口**：frontmatter `name: bug-reporter` + `description`；正文是 prompt 工作流。
- **依赖**：`submit_bug_report` 工具。

### 4.2 提交工具 `service/agent/bug_report_tool.py`
- **职责**：定义 `submit_bug_report` LangChain 工具（仿 `document_plan_tool.submit_document_plan`）。入参：
  `title, description, repro_steps, expected, actual, include_logs: bool`。
  调用即触发 HITL 中断 → 产出**确认卡片**（含字段摘要 + 自动环境摘要 + "将附日志: 是/否"）。用户 approve 后，由 HITL resume 通路调用 `feedback_service.submit_feedback(...)` 真正上报。
- **接口**：`submit_bug_report`（工具对象）。
- **依赖**：`feedback_service`；HITL 机制（`interrupt_on`/`HITL_INTERRUPT_ON`）。
- **注册（按实测门控，非无条件）**：`employee.py:224-225` 里 `submit_document_plan` 只在 `if enable_hitl or clarify_only_hitl:` 分支内 append，且确认中断只在 `enable_hitl` 时生效（`:248-251`）。故：
  - 把 `submit_bug_report` 加进**同一 HITL 分支**的 `extra_tools`；
  - 把它的工具名加入 `HITL_INTERRUPT_ON`（`hitl_interrupt_on.py`），使调用产出确认卡片；
  - **本员工会话须以 `enable_hitl=True` 运行**，确认中断才会触发——实现计划需确认 bug-reporter 走的是哪条 employee 装配分支，必要时为其强制 `enable_hitl`。
  - 工具对全员可见无妨——只有本员工 SKILL.md 指示使用。

### 4.3 反馈服务 `service/feedback_service.py`
- **职责**：纯逻辑，组装并发送上报。
  - `collect_env() -> dict`：app_version(env `APP_VERSION`)、os/arch(`platform`)、user(来自 auth/当前登录)、offline(`OFFLINE_MODE`)。
  - `collect_logs(cap_lines=500, cap_bytes=200_000) -> str | None`：读取 `app.log`+`error.log` 末尾，截断封顶；仅 `include_logs` 时调用。
  - `submit_feedback(payload, token) -> dict`：用 **`httpx.post(get_settings().feedback_url, json=payload, headers={"token": token}, timeout=30)`**（与 login 范式一致），`raise_for_status` 后返回远端 JSON；未配置 `feedback_url`/网络错误时返回规范化错误（不抛栈给模型）。
- **接口**：上述三函数。
- **依赖**：`config`（`feedback_url`）、`httpx`、`platform`、日志路径。
- **隔离**：不依赖 agent 框架，可独立单测（mock `httpx`）。

### 4.4 本地端点 `api/feedback_api.py`
- **职责**：`POST /feedback`，body=组装好的上报，转发到远端（调 `feedback_service.submit_feedback`），回传结果。供工具路径之外的调用方/将来 UI 复用。
- **接口**：`POST /feedback`，装饰器加 `dependencies=[Depends(require_capability("remote_feedback"))]` 做**离线门控**（与 `login` 一致）；从 `token` 请求头取用户 token 转发。
- **依赖**：`feedback_service`、`require_capability`。
- **实现模板**：以 `login_api.py` 的 `register_proxy`（`:95-118`，同时有 capability dep + `_forward_token_headers` 读 `token` 头）为最近样板，而非不读 token 的 `login` 路由。
- **说明**：agent 路径也可直接调 `feedback_service`（不强制走 HTTP 自环）；端点存在保证契约完整、可独立测。**注意**：agent 路径绕过路由级 capability 门控，故 `feedback_service.submit_feedback` 内部也应在 `OFFLINE_MODE` 时直接返回"离线不可上报"，双保险。

### 4.5 配置与能力位 `core/config.py` + `RuntimeCapabilities`
- 新增 `feedback_path` kv（键 `FEEDBACK_PATH`，默认占位如 `/yc/feedback`）→ 经 `join_base_and_path(platform_base_url, feedback_path)` 解析成 **`feedback_url: str | None`** 字段（完全镜像 `login_url`/`register_url`，见 `config.py:261-262,487`）。
- 在 `RuntimeCapabilities`（`src/core/runtime_capabilities.py`）新增 `remote_feedback` 能力位：在线=True、离线=False；供 `require_capability("remote_feedback")` 门控。
  - ⚠️ 实现注意：该 dataclass 在线分支用**位置参数**构造 `RuntimeCapabilities(*(True,) * 10, activation_enforced=...)`；加字段须把 `* 10` 改为 `* 11`，**并**在离线分支显式补该字段 `=False`，否则位置参数错位会静默 break。

### 4.6 Electron 一行改动 `electron/features/backend/backend-process.ts`
- 启动 backend 时注入 `APP_VERSION`（取 `app.getVersion()`/`__APP_VERSION__`）到 env，供 `collect_env()` 读取。

### 4.7 seed 一行 `service/employee_service.py`
- `_BUILTIN_SEED_EMPLOYEES` 增：`("问题反馈助手", ("bug-reporter",), "收集并提交 BUG 反馈到官方后台。")`。

## 5. 数据契约（上报载荷）
```jsonc
{
  "title": "…",
  "description": "…",
  "repro_steps": "…",
  "expected": "…",
  "actual": "…",
  "env": {
    "app_version": "1.2.3",
    "os": "Windows", "arch": "x64",
    "user": { "id/name": "…(来自 auth)" },
    "offline": false
  },
  "logs": "…(末尾截断, 仅 include_logs=true 时存在; 否则字段缺省)"
}
```
- **字段名可配置/可调**：远端接口未定，按此结构实现，拿到远端规范后调整映射即可。

## 6. 提交流程与错误处理
- **确认门（HITL）**：工具调用 → 中断出卡片 → 用户「确认提交」→ resume 上报。用户不确认/取消 → 不发送。
- **日志隐私**：默认不带；员工显式问 + 卡片明示"将附日志"，用户最后把关。
- **错误**：
  - 远端不可达/超时 → 工具返回可读失败（"上报失败：网络不可达，请稍后重试"），不抛栈给模型。
  - `feedback_url` 未配置（`REMOTE_API_BASE_URL`/`FEEDBACK_PATH` 缺失）→ 明确提示"反馈服务未配置"。
  - **离线模式**（`OFFLINE_MODE=1`）→ 路由级 `require_capability("remote_feedback")` 直接拦截；agent 直调路径由 `submit_feedback` 内部判 `OFFLINE_MODE` 返回"离线不可上报"。
  - 日志文件不存在/读失败 → 跳过日志、照常提交正文+环境（不阻断）。

## 7. 鉴权
- 转发带**当前登录用户 token**，经 **`token` 请求头**（与 `login_api._forward_token_headers` 一致，**非** `Authorization: Bearer`）；远端据此识别上报人。后续若远端要服务密钥，再加配置键。

## 8. 测试
- `feedback_service`：
  - `collect_env` 字段齐全（mock env/platform/auth）。
  - `collect_logs` 截断封顶、文件缺失返回 None。
  - `submit_feedback`：`feedback_url` 未配置时报错、`OFFLINE_MODE` 时返回离线错误、远端错误规范化（mock `httpx`）、`token` 头透传。
- `bug_report_tool`：确认卡片结构正确；approve 后才调用 `submit_feedback`；`include_logs` 透传。
- `/feedback` 端点：`require_capability("remote_feedback")` 离线拦截、在线转发 mock 远端、`token` 头透传。
- seed：`_BUILTIN_SEED_EMPLOYEES` 含新员工；`ensure_builtin_seed_employees` 幂等、对已有空间补建（沿用现有 seed 测试风格）。

## 9. 可配置/待定（你的远端那侧，不阻塞本期实现）
1. `FEEDBACK_PATH` 实际路径、HTTP 方法、期望 JSON 字段名 → 拿到远端接口后填配置/调映射。
2. 鉴权：默认转发登录 token；如需服务密钥另加键。
3. `APP_VERSION` 注入方式：env 注入（本设计采用）。

## 10. 风险
- **日志含敏感信息**：靠"默认不带 + 显式询问 + 卡片明示 + 末尾截断"控制；不抓全量、不带会话内容。
- **APP_VERSION 来源**：未注入时 `collect_env` 退化为 "unknown"，不阻断上报。
- **远端契约漂移**：字段名集中在 `feedback_service` 一处映射，远端定稿后改动面小。
