# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Digital Employee Client Web - A React 19 + TypeScript web desktop application using Vite, Turbo, and TanStack Router, with Electron desktop support. The app integrates a Python backend (FastAPI) that is managed as a child process.

## Environment Requirements

- **Node.js** >= 20
- **pnpm** >= 10.33.0 (use `corepack enable` to enable)

## Build & Development Commands

```bash
# Web browser mode (default)
pnpm dev

# Electron desktop mode
pnpm --filter web dev:app

# Build all packages
pnpm build

# Build Electron app
pnpm --filter web build:app

# Package-specific commands
pnpm --filter web lint
pnpm --filter @workspace/ui typecheck
```

## Monorepo Structure

```
apps/web           # Main application (TanStack Router + React Query + Electron)
packages/ui        # Shared UI component library (Radix UI + Tailwind CSS)
```

## Architecture

### TanStack Router (File-based Routing)

Routes are defined in `apps/web/src/routes/` using file-based routing. Files map directly to URL paths:
- `routes/index.tsx` → `/`
- `routes/demo.tsx` → `/demo`
- `routes/posts/$postId.tsx` → `/posts/:postId` (dynamic)

Use `createFileRoute` for route definitions:

```typescript
export const Route = createFileRoute("/demo")({
  component: DemoPage,
})
```

The route tree is auto-generated to `routeTree.gen.ts` - do not edit manually.

Route-based code splitting is enabled via `autoCodeSplitting: true` in the TanStack Router plugin config.

### Layouts

Use `__root.tsx` for the root layout (all pages render in its `<Outlet />`). For nested layouts, create a layout file in a subdirectory:

```
routes/
├── dashboard.tsx          → /dashboard (Layout with <Outlet />)
└── dashboard/
    ├── index.tsx          → /dashboard
    ├── analytics.tsx      → /dashboard/analytics
    └── settings.tsx       → /dashboard/settings
```

### Electron Integration

The Electron main process (`apps/web/electron/main/`) manages:
- **Window creation and lifecycle** (`index.ts`)
- **Python backend process management** (`backend.ts`) - starts/stops a FastAPI server on port 58000
- **IPC handlers** (`ipc-handlers.ts`) - communication between main and renderer
- **Auto-update** (`update.ts`)

The Python backend path:
- Development: `<APP_ROOT>/py-server/backend.exe`
- Production: `<resourcesPath>/py-server/backend.exe`

### State Management

- **Server state**: TanStack Query (`@tanstack/react-query`)
- **Client state**: Zustand (`zustand`)
- **Theme**: `next-themes` with `ThemeProvider` component

### Navigation

```typescript
import { Link } from "@tanstack/react-router"

// Declarative navigation
;<Link to="/demo">Go to Demo</Link>

// Imperative navigation
import { useNavigate } from "@tanstack/react-router"
const navigate = useNavigate()
navigate({ to: "/demo" })
```

### API Proxy

Vite dev server proxies:
- `/actus` → `http://localhost:58000` (path rewrite removes `/actus` prefix)
- `/digital` → `http://localhost:58000` (path passed as-is)

## Key Libraries

| Purpose | Library |
|---------|---------|
| Router | TanStack Router (file-based, type-safe) |
| Server State | TanStack Query |
| UI Components | Radix UI + shadcn/ui patterns |
| Styling | Tailwind CSS v4 + class-variance-authority |
| Icons | @tabler/icons-react |
| AI Integration | AI SDK (`ai` package) + @ai-sdk/react |
| Editor | Lexical (`@lexical/react`) |
| Desktop | Electron 41 |
| Process Management | electron-store, electron-updater |

## Code Style (from AGENTS.md)

- **No semicolons**, **double quotes** for strings
- **2 space indentation**, **80 character line width**
- Import order: React/external → local components → utils/hooks/types
- Components: named exports, PascalCase
- Hooks: `use` prefix (camelCase)
- Utilities: camelCase
- Constants: UPPER_SNAKE_CASE
- Interfaces/Types: PascalCase

Use `cn()` from `@workspace/ui/lib/utils` for Tailwind class merging and `cva()` for component variants.

## Path Aliases

- `@/*` → `./src/*` (in apps/web)
- `@workspace/ui/*` → `../../packages/ui/src/*` (in apps/web)

## UI Component Development

Add components to `packages/ui` using shadcn CLI:

```bash
pnpm dlx shadcn@latest add button -c apps/web
```

Then import in app:

```typescript
import { Button } from "@workspace/ui/components/button"
```

## TypeScript

Strict mode enabled. Use `React.ComponentProps` for spreading native element props and `VariantProps` from `class-variance-authority` for variant types.

## Testing

**No test framework is currently configured.** When adding tests, use Vitest or Jest.

## Code Quality

```bash
pnpm lint        # ESLint check
pnpm format      # Prettier formatting (sorts Tailwind classes)
pnpm typecheck   # TypeScript type checking
```

Run `turbo lint` and `turbo typecheck` before committing.
