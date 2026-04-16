# Agents Guide

Monorepo：React 19 + Electron 前端（`apps/web`）、Python FastAPI 后端（`apps/server`）、共享 UI 组件库（`packages/ui`）。

## Project Structure

- `apps/web` — Electron + React 19 SPA，TanStack Router 文件路由 + React Query
- `apps/server` — Python FastAPI 后端（deepagents + LangGraph + SQLAlchemy）
- `packages/ui` — Radix UI + shadcn/ui + Tailwind CSS v4 组件库
- `scripts/` — 构建脚本（`build-server.py` 等）

## Build & Development Commands

### 前端（apps/web + packages/ui）

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
pnpm --filter web dev:app
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

# 打包为 exe（输出到 apps/web/py-server/backend.exe）
pnpm build:server

# 打包完整应用（Python 后端 + Electron）
pnpm build:app
```

后端无测试目录。`README.md` 中提到的 `tests/` 文件不存在。

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

### Agent 系统

`src/service/agent.py` → `get_agent(skill_path, root_path)` 创建对话 agent：

- 使用 `deepagents`（v0.3.5）+ `langchain` + `langgraph`
- `src/service/custom_graph.py` → `create_deep_agent()` 配置 LangGraph 状态图
- Backend 是 Windows 兼容的 `WindowsCompatibleCompositeBackend`：
  - `/memories/` → StoreBackend（持久化）
  - `/skills/` → FilesystemBackend（员工技能目录）
  - `/agent/` → FilesystemBackend（`src/service/`，用于读取 `AGENTS.md`）
- Checkpointer：`MemorySaver`（内存，重启丢失）
- Store：`InMemoryStore`
- LLM：通过 `OPENAI_API_KEY` / `BASE_URL` / `DEEPAGENT_MODEL` 配置

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
- 只保留 `dispatch_type == "skill"` 的任务
- `EmployeeTask` 来自员工 `meta_json.tasks`，通过 `TaskService.sync_workspace_tasks()` 同步
- 支持确认流程：从 SKILL.md 解析 `confirm_url`，执行后写入 `TaskExecutionLog.confirm_url`
- 修改员工任务后需调用 `TaskSchedulerService.reload_jobs()` 刷新调度

### 环境变量（.env）

参考 `apps/server/.env.example`。关键项：

| 变量                       | 默认值                                              | 说明                                                                                             |
| -------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `SQLITE_PATH`              | `~/.digital-employee/data/app.db`                   | **注意**：`.env.example` 里的路径已过时，实际默认值在 `config.py` 的 `get_default_sqlite_path()` |
| `SERVER_PORT`              | `58000`                                             | 服务端口                                                                                         |
| `ENVIRONMENT`              | `dev`                                               | dev/prod                                                                                         |
| `OPENAI_API_KEY`           | —                                                   | LLM API Key                                                                                      |
| `BASE_URL`                 | `https://dashscope.aliyuncs.com/compatible-mode/v1` | LLM API 地址                                                                                     |
| `DEEPAGENT_MODEL`          | `qwen2.5-72b-instruct`                              | Agent 使用的模型                                                                                 |
| `SKILL_REMOTE_BASE_URL`    | —                                                   | 远程技能服务地址                                                                                 |
| `AGENT_INTERFACE_BASE_URL` | —                                                   | Agent Interface 服务地址                                                                         |
| `DBCHAT_BASE_URL`          | —                                                   | DB Chat 服务地址                                                                                 |
| `LOGIN_URL`                | —                                                   | 登录页面地址                                                                                     |
| `DEFAULT_WORKSPACE_ID`     | `1`                                                 | 默认工作空间 ID                                                                                  |
| `EMPLOYEE_ZIP_URL`         | —                                                   | 远程员工 ZIP 下载地址                                                                            |

### 已知问题

- **无测试**：`tests/` 目录不存在。

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
