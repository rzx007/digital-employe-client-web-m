---
name: dev-usage-manual
description: 数字员工客户端项目开发使用手册。当开发者询问项目如何搭建开发环境、运行构建命令、理解前后端架构、配置 AI Agent 和技能系统、打包 Electron 应用、开发扩展插件，或遇到开发环境问题时使用。涵盖命令速查、架构说明、故障排查等日常开发操作。
---

# 开发者使用手册

数字员工客户端（Boban Staff Client Web）开发指南。Monorepo：React 19 + Electron 前端（`apps/web`）、Python FastAPI 后端（`apps/server`）、共享 UI 组件库（`packages/ui`）。

## 一、环境搭建

### 前置要求

| 工具 | 版本要求 | 安装方式 |
|------|---------|---------|
| Node.js | >= 20 | [nodejs.org](https://nodejs.org/) 或 nvm |
| pnpm | >= 10.33 | `corepack enable`（推荐）或 `npm i -g pnpm` |
| Python | >= 3.11 | [python.org](https://python.org/) |
| uv | 最新 | `pip install uv` 或 [astral.sh/uv](https://docs.astral.sh/uv/) |

### 安装依赖

```bash
corepack enable
pnpm install              # 安装所有 JS 依赖
cd apps/server && uv sync # 安装 Python 依赖
```

## 二、命令速查

### 前端（apps/web + packages/ui）

| 命令 | 说明 |
|------|------|
| `pnpm dev` | Web 开发服务器（默认 http://localhost:3399） |
| `pnpm build` | 构建所有包 |
| `pnpm lint` | ESLint 检查 |
| `pnpm format` | Prettier 格式化（含 Tailwind class 排序） |
| `pnpm typecheck` | TypeScript 类型检查 |
| `pnpm lint --filter=web` | 仅检查 web 包 |
| `pnpm build --filter=@workspace/ui` | 仅构建 UI 库 |
| `pnpm --filter digital-employee dev:app` | Electron 桌面端开发（自动启动 Python 后端） |
| `pnpm --filter digital-employee build:app` | Electron 正式打包 |

提交前必须运行 `pnpm lint` 和 `pnpm typecheck`。

### 后端（需在 apps/server 目录下执行）

| 命令 | 说明 |
|------|------|
| `uv sync` | 安装 Python 依赖 |
| `uv run python start.py` | 启动服务（默认 http://0.0.0.0:58000） |
| `uv run uvicorn src.server:app --reload --host 0.0.0.0 --port 58000` | 热重载开发 |
| `pnpm dev:server` | 从项目根目录启动后端 |

### 打包

| 命令 | 说明 |
|------|------|
| `python scripts/build-server.py` | 仅打包 Python 后端为 exe |
| `python scripts/build-server.py --clean` | 清理后打包 |
| `python scripts/build-server.py --debug` | 调试模式（保留临时文件） |
| `python scripts/build-server.py --app` | 打包 Python 后端 + Electron |

输出：`apps/web/py-server/backend.exe`（Windows）/ `backend`（Linux/macOS）。

## 三、前端架构

### 目录结构

```
apps/web/src/
├── main.tsx            # 入口：RouterProvider + QueryClient + ThemeProvider
├── routes/             # TanStack Router 文件路由（自动生成 routeTree.gen.ts）
├── api/                # API 客户端（auth, chat, employee, skill, task 等）
├── components/         # React 组件（chat, employee, settings, pet 等）
├── stores/             # Zustand 状态管理（auth, chat, artifact, monitor 等）
├── hooks/              # 自定义 Hook
├── lib/                # 工具函数
├── types/              # TypeScript 类型定义
└── icons/              # 图标组件
```

### 文件路由映射

| 文件路径 | URL 路径 |
|---------|---------|
| `routes/index.tsx` | `/`（聊天主页） |
| `routes/login.tsx` | `/login` |
| `routes/register.tsx` | `/register` |
| `routes/settings.tsx` | `/settings` |
| `routes/splash.tsx` | `/splash`（Electron 启动画面） |
| `routes/pet.tsx` | `/pet`（桌面宠物） |
| `routes/recruitment.tsx` | `/recruitment` |
| `routes/demo.tsx` | `/demo` |

`$` 前缀文件名为动态路由参数，通过 `useParams()` 获取。

### 添加新页面

在 `apps/web/src/routes/` 下新建 `.tsx` 文件即可：

```tsx
import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/about")({
  component: AboutPage,
})

function AboutPage() {
  return <div>About Page</div>
}
```

### 布局路由

`routes/__root.tsx` 为根布局。创建下划线前缀的布局文件包裹子路由：

```
routes/
├── dashboard.tsx              → /dashboard（Layout，内含 <Outlet />）
└── dashboard/
    ├── index.tsx              → /dashboard
    └── analytics.tsx          → /dashboard/analytics
```

### 关键库

| 用途 | 库 |
|------|----|
| 路由 | TanStack Router（文件路由） |
| 服务端状态 | TanStack Query |
| 客户端状态 | Zustand |
| UI 组件 | Radix UI + shadcn/ui（`asChild` 模式） |
| 样式 | Tailwind CSS v4, `cva()`, `cn()` |
| 图标 | Tabler Icons, Lucide |
| 图表 | Recharts |
| 富文本 | Lexical editor |
| AI 流式渲染 | `@ai-sdk/react` + `ai` SDK |
| 拖拽 | dnd-kit |
| 动画 | motion |

## 四、Python 后端架构

### 分层

```
start.py                   → 入口，加载 ENV 环境变量
src/server.py              → FastAPI app 创建
  lifespan:
    1. init_db()           → 建表 + ALTER TABLE 迁移
    2. ensure_default_workspace()
    3. sync_tasks()        → 从 employee meta_json 同步
    4. start_scheduler()   → APScheduler
src/api/                   → HTTP 路由层（17 个模块）
src/service/               → 业务逻辑层（40+ 模块）
src/models/                → SQLAlchemy ORM 模型（17 个）
src/schemas/               → Pydantic schema
src/db/                    → 数据库引擎和会话
src/core/config.py         → Settings dataclass
```

**入口是 `start.py`，不是 `main.py`**。

### 关键模型

Workspace、Employee、EmployeeSkill、EmployeeShiftSchedule、ChatGroup、GroupMember、Conversation、ConversationMessage、EmployeeTask、TaskExecutionLog、SkillRating。

修改模型后不需要手动写 migration，`init_db()` 中的 `ensure_column` 会自动补充新列。

### 环境变量

配置来源：`apps/server/config-kv.init.json` → 首次运行时写入数据库 `config_kvs` 表。**不从 `.env` 读取**（`ENVIRONMENT` 和 `SERVER_PORT` 除外）。

| 关键变量 | 默认值 | 说明 |
|---------|--------|------|
| `LLM_REGISTRY` | — | 多供应商 LLM 注册表 JSON（设置页管理 active 模型与 API Key） |
| `SQLITE_PATH` | `~/.digital-employee/data/app.db` | 数据库路径 |
| `SERVER_PORT` | `34567` | 服务端口 |

## 五、AI Agent 系统

### 架构

`src/service/agent.py` → `get_agent(skill_path, root_path)` 创建对话 agent：

- **deepagents**（v0.5.9）+ **langchain** + **langgraph**
- `src/service/custom_graph.py` → `create_deep_agent()` 配置 LangGraph 状态图
- **Backend**：`WindowsCompatibleCompositeBackend`
  - `/memories/` → StoreBackend（持久化记忆）
  - `/skills/` → FilesystemBackend（员工技能目录）
  - `/agent/` → FilesystemBackend（读取 `AGENTS.md`）
- **Checkpointer**：`MemorySaver`（内存，重启丢失）/ `AsyncSqliteSaver`
- **Store**：`InMemoryStore`

### LLM 配置

通过 `config_kvs` 表的 `LLM_REGISTRY` 配置（设置页管理已接入供应商与当前 active 模型）。默认种子为 DashScope + `deepseek-v4-flash`。

## 六、技能系统

### SKILL.md 格式

技能目录结构：`local-employees/<员工ID>/skills/<skill-name>/SKILL.md`

可包含配套文件：
```
<skill-name>/
├── SKILL.md          (必需)
├── scripts/          (可执行脚本)
├── references/       (参考文档)
└── assets/           (静态资源)
```

SKILL.md 头部 YAML frontmatter：
```yaml
---
name: skill-name
description: 触发条件描述
---
```

### 技能解析优先级

`ChatService.resolve_employee_skills_dir()` 查找顺序：

1. `local-employees/<employee_id>/skills/`
2. `local-employees/<employee_name>/skills/`
3. `local-employees/<employee_code>/skills/`
4. 数据库 `employee.skills_json` payload（兜底）

排查技能加载问题时，看日志中的 `Resolved employee skills from` 和 `available_skills=`。

### 内置技能

`apps/server/build-in-skills/` 下的技能会在应用启动时自动加载到默认工作空间。

## 七、Electron 桌面端

### 启动时序

```
initAuthStore() → 读 auth.json
  → createSplashWindow()（400x250 无框透明窗口，含加载动画）
    → startBackend()（启动 Python 子进程，健康检查轮询）
      → closeSplashWindow()
        → hasToken()?
          YES → createMainWindow() + restoreSession()
          NO  → createLoginWindow()
```

### 核心模块

| 目录 | 说明 |
|------|------|
| `electron/main/` | 主进程入口 |
| `electron/preload/` | 预加载脚本（`index.ts`, `extension-preload.ts`） |
| `electron/core/` | 基础设施（app-context, bootstrap, logger, IPC, services） |
| `electron/features/` | 功能模块（auth, backend, extension, notification-tray, pet, splash, update, window） |
| `electron/shared/` | 共享 IPC channels |

### 关键 Electron 特性

- **系统托盘**：右键菜单（显示窗口/打开设置/重启/退出），通知闪烁
- **桌面宠物**：独立无框透明窗口，Rive 动画，语音输入，拖拽移动
- **自动更新**：electron-updater，从 REMOTE_API_BASE_URL 解析更新源
- **扩展系统**：ZIP 安装，独立 BrowserWindow，权限控制

## 八、扩展（Extension）系统

### 插件类型

| 类型 | 说明 | 示例 |
|------|------|------|
| 纯 UI | 有界面无后台服务 | 仪表盘小部件 |
| UI + Service | 界面 + 本地 Node/Python 服务 | 数据分析工具 |
| Headless | 纯后台服务，无界面 | 定时数据同步 |
| Fetch | 使用 `host.network` API 进行网络请求 | 外部 API 对接 |
| Invoke | 使用 `extension.invoke` + host events | 系统集成 |

### Manifest 格式

配置文件 `digital-employee.extension.json`：

```json
{
  "id": "my-extension",
  "version": "1.0.0",
  "displayName": "My Extension",
  "permissions": ["host.network"],
  "network": { "allowlist": ["*.example.com"] },
  "ui": { "window": { "width": 800, "height": 600 } }
}
```

### 用户操作

- 安装 ZIP 插件到 `~/.digital-employee/extensions/<id>/`
- 启用/禁用
- 打开插件独立窗口
- 卸载

详见 `docs/extension-development-guide.md`（599 行完整规范）。

## 九、代码规范

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

### 添加 UI 组件

```bash
pnpm dlx shadcn@latest add button -c apps/web
```

## 十、常见问题排查

### macOS 架构不一致

问题：`pydantic_core` / `dlopen` 报错 `have 'arm64', need 'x86_64'`，或 `dmg-builder` 报 `Library not loaded: /usr/local/opt/gettext/lib/libintl.8.dylib`。

原因：NVM 装成了 x86_64（Rosetta）版 Node，`uv sync` 在 arm64 下装了 wheel。

排查：`node -p process.arch` 应输出 `arm64`。

解决：在原生 arm64 终端重装 Node，删除 `apps/server/.venv` 后重新 `uv sync`。

### 技能未加载

排查步骤：
1. 查看 `app.log` 中的 `Resolved employee skills from` 日志
2. 确认 `local-employees/<员工ID>/skills/` 路径存在
3. 确认 SKILL.md 格式正确（含 YAML frontmatter）
4. 确认数据库 `employee.skills_json` 中有兜底配置

### 日志路径

所有日志位于 `~/.digital-employee/logs/`：

| 文件 | 来源 |
|------|------|
| `main.log` | Electron 主进程 |
| `app.log` | Python 后端应用日志 |
| `error.log` | Python 后端错误日志 |

### 数据库

默认 SQLite 路径：`~/.digital-employee/data/app.db`。可通过 `SQLITE_PATH` 环境变量修改。
