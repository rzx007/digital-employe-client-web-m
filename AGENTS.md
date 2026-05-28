# Agents Guide

Monorepo：React 19 + Electron 前端（`apps/web`）、Python FastAPI 后端（`apps/server`）、共享 UI 组件库（`packages/ui`）。

## Project Structure

- `apps/web` — Electron + React 19 SPA，TanStack Router 文件路由 + React Query
- `apps/server` — Python FastAPI 后端（deepagents + LangGraph + SQLAlchemy）
- `packages/ui` — Radix UI + shadcn/ui + Tailwind CSS v4 组件库
- `scripts/` — 构建脚本（`build-server.py` 等）

### 宿主日志目录

Electron 主进程与 Python 后端日志统一在 `~/.digital-employee/logs/`：

| 文件 | 来源 |
|------|------|
| `main.log` | Electron 主进程（[`apps/web/electron/core/data-paths.ts`](apps/web/electron/core/data-paths.ts)） |
| `app.log` / `error.log` | Python 后端（[`apps/server/src/core/config.py`](apps/server/src/core/config.py) `get_default_logs_dir()`） |

### 桌面宠物目录

| 路径 | 用途 |
|------|------|
| `~/.digital-employee/pets/<folder>/` | 本应用 zip 安装 / 手动导入（[`pet-paths.ts`](apps/web/electron/features/pet/pet-paths.ts)） |
| `~/.codex/pets/<folder>/` | Codex/Petdex 生态兼容；只读扫描 |

每包需 `pet.json` + 雪碧图。列表 slug 为**文件夹名**；`resolvePetFolder` 支持 `meta.id` 与目录名不一致时的回退匹配。

### 前端（apps/web + packages/ui）

聊天 API/UI 类型分层见 [`CHAT_DATA_TYPES.md`](apps/web/src/lib/chat/CHAT_DATA_TYPES.md)；会话消息流转（Query / useChat / SSE / hydrate / HITL 展示）见 [`conversation-message-flow.md`](apps/web/src/lib/chat/conversation-message-flow.md)。

```bash
pnpm install          # 安装依赖（需要 Node >= 20, pnpm >= 10.33）
pnpm dev              # Web 开发服务器，默认 http://localhost:3399
pnpm build            # 构建所有包
pnpm lint             # ESLint
pnpm format           # Prettier（自动排序 Tailwind classes）
pnpm typecheck        # TypeScript 类型检查

# 针对特定包
pnpm lint --filter=web
pnpm build --filter=@workspace/ui

# Electron 桌面端开发（自动启动 Python 后端）
pnpm --filter digital-employee dev:app

# Electron 正式打包（必须使用 arm64 原生 Node，见下方 macOS 架构说明）
pnpm --filter digital-employee build:app
```

前端无测试框架。添加测试前先配置 Vitest。

提交前必须运行 `pnpm lint` 和 `pnpm typecheck`。

### Python 后端（apps/server）

```bash
# 所有 Python 命令需要在 apps/server/ 目录下执行
cd apps/server

# 安装依赖
uv sync

# 启动服务（默认 http://0.0.0.0:58000）
uv run python start.py

# 热重载开发
uv run uvicorn src.server:app --host 0.0.0.0 --port 58000 --reload

# 从项目根目录启动
pnpm dev:server

# 打包后端（Windows → apps/web/py-server/backend.exe；macOS/Linux → backend）
pnpm build:server

# 打包完整应用（Python 后端 + Electron）
pnpm build:app
```

### macOS（Apple Silicon）架构与 venv

若出现 `pydantic_core` / `dlopen` 报错：`have 'arm64', need 'x86_64'`（或相反），或 Electron 打包时 `dmg-builder` 报错 `Library not loaded: /usr/local/opt/gettext/lib/libintl.8.dylib`，说明 **Node 与 Python 依赖的二进制架构不一致**。常见原因是 NVM 装成了 x86_64（Rosetta）版 Node，而 `uv sync` 在 arm64 下装了 wheel。

**验证 Node 架构**：`node -p process.arch` 应输出 `arm64`，`file "$(which node)"` 应包含 `arm64`。若输出 `x64` 或 `x86_64`，说明是 Rosetta 转译版。

**处理**：在 **原生 arm64** 终端中重装 Node（`nvm uninstall <version>` → `nvm install <version>`），删除 `apps/server/.venv` 后重新 `uv sync`。勿在「使用 Rosetta 打开」的终端里安装/同步 Python 依赖。

后端测试（pytest）位于 `apps/server/tests/`：

```bash
cd apps/server
uv sync --group dev
uv run pytest
```

## apps/server 架构（Python 后端）

### 分层

```
start.py             → 入口，加载 ENV 环境变量
src/server.py        → FastAPI app 创建，lifespan：init_db → ensure_default_workspace → sync_tasks → start_scheduler
src/api/             → HTTP 路由层（chat_api, employee_api, workspace_api, task_api, skill_api, skill_rating_api, model_api, login_api, group_api）
src/service/         → 业务逻辑
src/models/          → SQLAlchemy ORM 模型
src/schemas/         → Pydantic schema
src/db/              → 数据库引擎 + session（get_engine, get_session_local, get_db, init_db）
src/core/config.py   → Settings dataclass，从 .env 读取所有配置
```

**入口是 `start.py`，不是 `main.py`**（main.py 只是一个占位符）。

### 关键模型

Workspace、Employee、EmployeeSkill、EmployeeShiftSchedule、ChatGroup、GroupMember、Conversation、ConversationMessage、EmployeeTask、TaskExecutionLog、SkillRating。

`init_db()` 除了 `create_all`，还自动执行 ALTER TABLE 迁移（为旧表补充新列）。修改模型后不需要手动写 migration，但需要确保 `init_db()` 中补上对应的 `ensure_column` 调用。

### 架构文档（apps/server/docs）

- [可恢复流](./apps/server/docs/resumable-stream-architecture.md) — SSE buffer、resume、落库
- [HITL 人机协同](./apps/server/docs/hitl-architecture.md) — 澄清/方案审批、`message_id` 模型、数据流与待办
- [HITL tool invocation 报错](./apps/server/docs/hitl-tool-invocation-not-found.md) — `No tool invocation found for tool call ID` 成因与修复

### Agent 系统

`src/service/agent.py` → `get_agent(skill_path, root_path)` 创建对话 agent：

- 使用 `deepagents`（v0.5.3）+ `langchain` + `langgraph`
- `src/service/custom_graph.py` → `create_deep_agent()` 配置 LangGraph 状态图
- Backend 是 Windows 兼容的 `WindowsCompatibleCompositeBackend`：
  - `/memories/` → StoreBackend（持久化）
  - `/skills/` → FilesystemBackend（员工技能目录）
  - `/agent/` → FilesystemBackend（`src/service/`，用于读取 `AGENTS.md`）
- Checkpointer：`MemorySaver`（内存，重启丢失）
- Store：`InMemoryStore`
- LLM：通过 `config_kvs` 的 `LLM_REGISTRY`（多供应商注册表，含 `active_provider_id` / `active_model_id`）配置；统一经 `src/llm/factory.build_chat_model()` 创建实例；运行时只读 registry，四键仅用于一次性迁移写入 `LLM_REGISTRY`（不删 DB 行）

### 多供应商 LLM（`src/llm/`）

- 迁移与兼容逻辑总览：[`apps/server/docs/compatibility-inventory.md`](apps/server/docs/compatibility-inventory.md)（含四键 → `LLM_REGISTRY` 待移除清单）
- `src/llm/registry.py`：`LLM_REGISTRY` JSON（多家供应商凭证 + 模型清单）；全局仅一对 `active_provider_id` / `active_model_id`；设置页 Radio 单选激活
- `src/llm/providers/catalog.py`：静态供应商目录（DashScope、DeepSeek 官方、OpenAI、Moonshot、智谱、SiliconFlow + custom）
- `src/llm/factory.py`：`build_chat_model()` 合并 KV 配置并应用上下文 profile
- `src/llm/connection.py`：设置页探活（`GET /models` → fallback `POST /chat/completions`）
- **注意**：DashScope 与 DeepSeek 官方的模型名不可混用（如 `deepseek-v4-flash` 仅适用于 DashScope，`deepseek-chat` 适用于 DeepSeek 官方）
- DeepSeek V4 模型在 `build_chat_model()` 中自动注入 `extra_body={"thinking": {"type": "disabled"}}`（LangChain 尚未正确回传 `reasoning_content`，Agent 工具调用会 400）
- `model_patch` 仅在 active 供应商为 dashscope（或目录标记）时启用，用于 DashScope 上下文超长错误兼容

### 技能（Skills）解析优先级

`ChatService.resolve_employee_skills_dir()` 按以下顺序查找：

1. `local-employees/<employee_id>/skills/`
2. `local-employees/<employee_name>/skills/`
3. `local-employees/<employee_code>/skills/`
4. 数据库 `employee.skills_json` payload（兜底）

本地技能目录结构：`local-employees/<员工ID>/skills/<skill-name>/SKILL.md`

排查技能加载问题时，看日志中的 `Resolved employee skills from` 和 `available_skills=`，不要先猜数据库。

### 任务调度

- `TaskSchedulerService`：APScheduler BackgroundScheduler，CST 时区
- 只调度 `dispatch_type` 为 `skill` 或 `mcp` 的活跃任务
- `employee_tasks` 表是任务唯一数据源；创建/编辑员工时通过 `TaskService.upsert_employee_tasks()` 写入
- `GET /workspaces/{id}/tasks/sync` 仅重算活跃任务的 `next_run_at` 并调用 `TaskSchedulerService.reload_jobs()`
- 支持确认流程：从 SKILL.md 解析 `confirm_url`，执行后写入 `TaskExecutionLog.confirm_url`
- 修改员工任务后需调用 `TaskSchedulerService.reload_jobs()` 刷新调度

### 环境变量（.env）

参考 `apps/server/.env.example`。关键项：

| 变量                       | 默认值                                              | 说明                                                                                             |
| -------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `SQLITE_PATH`              | `~/.digital-employee/data/app.db`                   | **注意**：`.env.example` 里的路径已过时，实际默认值在 `config.py` 的 `get_default_sqlite_path()` |
| `SERVER_PORT`              | `58000`                                             | 服务端口                                                                                         |
| `ENVIRONMENT`              | `dev`                                               | dev/prod                                                                                         |
| `LLM_REGISTRY`             | —                                                   | 多供应商注册表 JSON（唯一 LLM 配置存储）；`active_*` 为当前使用的供应商与模型 |
| `SKILL_REMOTE_BASE_URL`    | —                                                   | 远程技能服务地址                                                                                 |
| `AGENT_INTERFACE_BASE_URL` | —                                                   | Agent Interface 服务地址                                                                         |
| `DBCHAT_BASE_URL`          | —                                                   | DB Chat 服务地址                                                                                 |
| `LOGIN_URL`                | —                                                   | 登录页面地址                                                                                     |
| `DEFAULT_WORKSPACE_ID`     | `1`                                                 | 默认工作空间 ID                                                                                  |
| `OFFLINE_MODE`             | `0`                                                 | 设为 `1` 启用离线模式（跳过登录、禁用远程集成，保留本地聊天/技能与调度）                         |

#### 离线模式（OFFLINE_MODE）

离线模式下，应用将跳过登录、禁用远程平台集成（技能/MCP/绩效/派单/自动更新），保留本地聊天、本地/内置技能、本地员工 CRUD、本地任务调度与设置页手动 LLM 配置。

```powershell
# 开发（PowerShell）
$env:OFFLINE_MODE="1"; pnpm dev:server
$env:OFFLINE_MODE="1"; pnpm --filter digital-employee dev:app

# 打包离线版安装包
pnpm build:app:offline

# Linux ARM64 离线 deb（须在 arm64 macOS + Docker 上运行）
pnpm build:deb:arm64:offline
```

架构入口文件：`apps/server/src/core/runtime_capabilities.py` 和 `apps/server/src/core/remote_gateway.py`。
离线版最小 KV（配置在设置页或通过 `config-kv.init.json` 种子写入）：`LLM_REGISTRY`（或遗留的 `DEEPAGENT_MODEL`、`OPENAI_API_KEY`、`BASE_URL`）。

### 已知问题

- **测试**：`apps/server/tests/`（pytest）；`uv run pytest`。

### 打包

```bash
# 仅打包 Python 后端
python scripts/build-server.py

# 清理后打包
python scripts/build-server.py --clean

# 调试模式
python scripts/build-server.py --debug

# 打包 Python 后端 + Electron
python scripts/build-server.py --app
```

输出：`apps/web/py-server/backend.exe`（Windows）/ `backend`（Linux/macOS）。

- **Mac DMG（Apple Silicon）**：`build:app` 直接调用 `electron-builder`，**必须使用 arm64 原生 Node**，否则默认打 x64 包导致 dmg-builder/gettext 失败（x86_64 dmgbuild 二进制编译于较新 macOS，在旧系统上无法运行）。若使用 Rosetta Node 打包，需手动加 `--mac --arm64` 参数。若仍异常可清理 `~/Library/Caches/electron-builder/dmg-builder*` 后重打。
- **Mac 自动更新**：`mac.target` 需含 `zip`；上传到更新服务器的 `macos/` 目录须包含 `latest-mac.yml` 与同版本 `.zip`（仅 DMG 会导致 `ZIP file not provided`）。详见 `apps/web/electron/README.md`。

## 前端 Code Style

### Imports

分组排序：React + 外部包 → 本地组件 → utils/hooks/types。

```typescript
import * as React from "react"
import { Link } from "@tanstack/react-router"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
```

### Formatting

- 无分号（Prettier 规则）
- 双引号
- 尾逗号
- 2 空格缩进
- 80 字符行宽
- Tailwind classes 由 prettier-plugin-tailwindcss 自动排序

### Naming

- Components: PascalCase
- Hooks: `use` 前缀 + camelCase
- Utilities: camelCase
- Constants: UPPER_SNAKE_CASE
- Interfaces/Types: PascalCase

### Key Libraries

- Router: TanStack Router（文件路由，`src/routes/`，自动生成 `routeTree.gen.ts`）
- State: TanStack Query
- UI: Radix UI + shadcn/ui（使用 `asChild` 模式）
- Styling: Tailwind CSS v4, `cva()` variants, `cn()` 合并

### Workspace Imports

- `@/*` → `./src/*`（in apps/web）
- `@workspace/ui/*` → 共享 UI 组件

### Adding UI Components

```bash
pnpm dlx shadcn@latest add button -c apps/web
```
