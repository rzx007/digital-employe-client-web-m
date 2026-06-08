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
- **远端转发范式**：`apps/server/src/api/login_api.py` 用 `REMOTE_API_BASE_URL + *_PATH`（如 `REGISTER_PATH`）+ `remote_gateway`（`apps/server/src/core/remote_gateway.py` 的 `sync_post`）转发；配置键在 `config.py`。
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
            POST /feedback (api/feedback_api.py)
                     │  remote_gateway.sync_post
                     ▼
            REMOTE_API_BASE_URL + FEEDBACK_PATH  (你的远端后台)
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
- **注册**：`employee.py` `extra_tools.append(submit_bug_report)`；加入 `HITL_INTERRUPT_ON` 使其挂确认中断。（工具对全员可见无妨——只有本员工 SKILL.md 指示使用。）

### 4.3 反馈服务 `service/feedback_service.py`
- **职责**：纯逻辑，组装并发送上报。
  - `collect_env() -> dict`：app_version(env `APP_VERSION`)、os/arch(`platform`)、user(来自 auth/当前登录)、offline(`OFFLINE_MODE`)。
  - `collect_logs(cap_lines=500, cap_bytes=200_000) -> str | None`：读取 `app.log`+`error.log` 末尾，截断封顶；仅 `include_logs` 时调用。
  - `submit_feedback(payload, auth_token) -> dict`：拼 `REMOTE_API_BASE_URL + FEEDBACK_PATH`，`remote_gateway.sync_post`，带 `Authorization`；返回远端结果或规范化错误。
- **接口**：上述三函数。
- **依赖**：`config`（`remote_api_base_url`、`feedback_path`）、`remote_gateway`、`platform`、日志路径。
- **隔离**：不依赖 agent/HTTP 框架，可独立单测。

### 4.4 本地端点 `api/feedback_api.py`
- **职责**：`POST /feedback`，body=组装好的上报，转发到远端（调 `feedback_service.submit_feedback`），回传结果。供工具路径之外的调用方/将来 UI 复用。
- **接口**：`POST /feedback`。
- **依赖**：`feedback_service`、鉴权依赖（取当前用户 token）。
- **说明**：agent 路径也可直接调 `feedback_service`（不强制走 HTTP 自环）；端点存在保证契约完整、可独立测。

### 4.5 配置 `core/config.py`
- 新增 `feedback_path: str`（键 `FEEDBACK_PATH`，默认占位如 `/api/feedback`），与 `remote_api_base_url` 同源解析。

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
  - `REMOTE_API_BASE_URL`/`FEEDBACK_PATH` 未配置 → 明确提示"反馈服务未配置"。
  - 日志文件不存在/读失败 → 跳过日志、照常提交正文+环境（不阻断）。

## 7. 鉴权
- 转发带**当前登录用户 token**（与 `login_api` 转发一致）；远端据此识别上报人。后续若远端要服务密钥，再加配置键。

## 8. 测试
- `feedback_service`：
  - `collect_env` 字段齐全（mock env/platform/auth）。
  - `collect_logs` 截断封顶、文件缺失返回 None。
  - `submit_feedback` URL 拼接正确、未配置时报错、远端错误规范化（mock `remote_gateway`）。
- `bug_report_tool`：确认卡片结构正确；approve 后才调用 `submit_feedback`；`include_logs` 透传。
- `/feedback` 端点：转发 mock 远端、鉴权透传。
- seed：`_BUILTIN_SEED_EMPLOYEES` 含新员工；`ensure_builtin_seed_employees` 幂等、对已有空间补建（沿用现有 seed 测试风格）。

## 9. 可配置/待定（你的远端那侧，不阻塞本期实现）
1. `FEEDBACK_PATH` 实际路径、HTTP 方法、期望 JSON 字段名 → 拿到远端接口后填配置/调映射。
2. 鉴权：默认转发登录 token；如需服务密钥另加键。
3. `APP_VERSION` 注入方式：env 注入（本设计采用）。

## 10. 风险
- **日志含敏感信息**：靠"默认不带 + 显式询问 + 卡片明示 + 末尾截断"控制；不抓全量、不带会话内容。
- **APP_VERSION 来源**：未注入时 `collect_env` 退化为 "unknown"，不阻断上报。
- **远端契约漂移**：字段名集中在 `feedback_service` 一处映射，远端定稿后改动面小。
