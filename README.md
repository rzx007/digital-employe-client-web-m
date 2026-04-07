# Digital Employee Client Web

基于 React 19 + TypeScript 的 Web 桌面端应用，使用 Vite、Turbo、TanStack Router 构建，同时支持 Electron 桌面端。

## 环境要求

- **Node.js** >= 20
- **pnpm** >= 10.33.0（推荐使用 [Corepack](https://nodejs.org/api/corepack.html) 启用）

## 安装依赖

```bash
# 启用 corepack（可选，用于自动管理 pnpm 版本）
corepack enable

# 安装所有依赖
pnpm install
```

## 快速开发

```bash
# 启动 Web 开发服务器（浏览器模式）
pnpm dev

# 启动 Electron 桌面端开发
pnpm --filter web dev:app

# 构建所有包
pnpm build

# 构建 Electron 桌面端应用
pnpm --filter web build:app
```

开发服务器启动后，浏览器访问终端中显示的地址即可（默认 `http://localhost:3399`）。

## 常用命令

| 命令             | 说明                |
| ---------------- | ------------------- |
| `pnpm dev`       | 启动开发模式        |
| `pnpm build`     | 构建所有包          |
| `pnpm lint`      | ESLint 检查         |
| `pnpm format`    | Prettier 格式化     |
| `pnpm typecheck` | TypeScript 类型检查 |

如需针对特定包运行命令：

```bash
pnpm lint --filter=web
pnpm build --filter=@workspace/ui
```

## 项目结构

```
├── apps/web          # 主应用（TanStack Router + React Query + Electron）
├── packages/ui       # 共享 UI 组件库（Radix UI + Tailwind CSS）
└── AGENTS.md         # AI Agent 开发规范与代码风格指南
```

## 添加 UI 组件

通过 shadcn/ui CLI 添加组件到 `packages/ui`：

```bash
pnpm dlx shadcn@latest add button -c apps/web
```

在应用中使用：

```tsx
import { Button } from "@workspace/ui/components/button"
```

## TanStack Router 路由

本项目使用 TanStack Router 的**文件路由**（File-based Routing），路由定义在 `apps/web/src/routes/` 目录下，开发服务器启动时会自动生成 `routeTree.gen.ts`，无需手动维护路由表。

### 文件命名与路径映射

路由文件名直接映射为 URL 路径：

| 文件路径                   | URL 路径                 |
| -------------------------- | ------------------------ |
| `routes/index.tsx`         | `/`                      |
| `routes/demo.tsx`          | `/demo`                  |
| `routes/settings.tsx`      | `/settings`              |
| `routes/users/profile.tsx` | `/users/profile`         |
| `routes/posts/$postId.tsx` | `/posts/123`（动态参数） |

> 带 `$` 前缀的文件名为动态路由参数，通过 `useParams()` 获取值。

### 添加新页面

在 `apps/web/src/routes/` 下新建 `.tsx` 文件即可：

```tsx
// apps/web/src/routes/about.tsx
import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/about")({
  component: AboutPage,
})

function AboutPage() {
  return <div>About Page</div>
}
```

保存后路由自动注册，`routeTree.gen.ts` 会自动更新。

### 添加 Layout（布局路由）

使用 `__root.tsx` 作为根布局（已内置），或创建带下划线前缀的布局文件包裹子路由：

```tsx
// apps/web/src/routes/dashboard.tsx — 定义 layout
import { createFileRoute, Outlet } from "@tanstack/react-router"

export const Route = createFileRoute("/dashboard")({
  component: DashboardLayout,
})

function DashboardLayout() {
  return (
    <div className="flex h-svh">
      <aside>Sidebar</aside>
      <main>
        <Outlet />
      </main>
    </div>
  )
}
```

然后在子目录中创建嵌套页面，它们将自动渲染在 `Outlet` 中：

```
routes/
├── dashboard.tsx          → /dashboard（Layout）
└── dashboard/
    ├── index.tsx          → /dashboard（默认子页面）
    ├── analytics.tsx      → /dashboard/analytics
    └── settings.tsx       → /dashboard/settings
```

### 根布局

根布局文件为 `routes/__root.tsx`，所有页面都渲染在其 `<Outlet />` 中，适合放置全局 Provider、Toast 等公共元素。

### 页面跳转

```tsx
import { Link } from "@tanstack/react-router"

// 声明式
;<Link to="/demo">Go to Demo</Link>

// 命令式
import { useNavigate } from "@tanstack/react-router"
const navigate = useNavigate()
navigate({ to: "/demo" })
```

## 技术栈

- **React 19** + **TypeScript**
- **Vite 7** 构建工具
- **Turbo** Monorepo 管理
- **TanStack Router** 文件路由
- **TanStack Query** 服务端状态管理
- **Radix UI** + **shadcn/ui** 组件体系
- **Tailwind CSS v4** 样式
- **Electron** 桌面端支持
