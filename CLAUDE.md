# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common Commands

### General
| Command | Description |
|---------|-------------|
| `pnpm install` | Install all dependencies |
| `pnpm dev` | Start web development server (browser mode, default port 3399) |
| `pnpm --filter web dev:app` | Start Electron desktop development |
| `pnpm build` | Build all packages |
| `pnpm --filter web build:app` | Build Electron desktop application |
| `pnpm lint` | Run ESLint check |
| `pnpm format` | Run Prettier formatting |
| `pnpm typecheck` | Run TypeScript type checking |
| `pnpm dev:server` | Start Python backend (FastAPI) |
| `pnpm build:server` | Package Python backend to exe |
| `pnpm build:app` | Package full application (Python + Electron) |

### Filter commands by package
```bash
pnpm lint --filter=web
pnpm build --filter=@workspace/ui
```

### Python backend
```bash
# Manual start (from apps/server directory)
uv run uvicorn src.server:app --reload --host 0.0.0.0 --port 58000
```

### Add UI components
```bash
pnpm dlx shadcn@latest add button -c apps/web
```

## High Level Architecture

This is a monorepo built with Turbo:
- **`apps/web`**: Main Electron + React 19 application
  - Uses TanStack Router (file-based routing, routes defined in `src/routes/`)
  - Uses TanStack Query for server state management
  - Electron main process handles application lifecycle, backend startup, window management
  - Renderer process is a React SPA with TypeScript
- **`apps/server`**: Python FastAPI backend
  - SQLAlchemy ORM
  - Built to exe for distribution, output to `apps/web/py-server/backend.exe`
- **`packages/ui`**: Shared UI component library
  - Built with Radix UI primitives + shadcn/ui patterns + Tailwind CSS v4
  - Components are imported via `@workspace/ui/*` alias
- **`scripts/`**: Build and utility scripts

### Application Startup Flow
1. Initialize auth store (reads from auth.json)
2. Create splash window
3. Start Python backend service
4. Close splash window
5. Check for existing auth token:
   - **If token exists**: Create main window, restore session (from electron-store → localStorage + Zustand)
   - **If no token exists**: Create login window, wait for user authentication
6. API 401 responses will clear auth and redirect to login window

## Code Style Guidelines

### Imports Order
1. React and external packages
2. Local components
3. Utils/hooks/types
   ```typescript
   import * as React from "react"
   import { Link } from "@tanstack/react-router"
   import { Button } from "@workspace/ui/components/button"
   import { cn } from "@workspace/ui/lib/utils"
   ```

### Naming Conventions
- Components: PascalCase (`AppSidebar`, `Button`)
- Hooks: camelCase with `use` prefix (`useIsMobile`)
- Utilities: camelCase (`cn`, `formatDate`)
- Constants: UPPER_SNAKE_CASE (`MOBILE_BREAKPOINT`)
- Interfaces/Types: PascalCase (`ButtonProps`)

### Styling
- Use `cn()` utility for merging Tailwind classes
- Use `cva()` for component variants
- Tailwind classes are automatically sorted by Prettier plugin

### TypeScript
- Strict mode enabled
- Use `React.ComponentProps` for spreading native element props
- Use `VariantProps` from class-variance-authority for variant types
- Always run `pnpm typecheck` before submitting code changes

### Formatting Rules
- No semicolons
- Double quotes for strings
- Trailing commas in objects and arrays
- 2 space indentation
- 80 character line width
- Run `pnpm format` to apply all formatting rules automatically

### Key Patterns
- Use `asChild` pattern with Radix UI components for composability
- Use `createFileRoute` for TanStack Router file-based routing
- Workspace imports use aliases:
  - `@/*` → `./src/*` (in apps/web)
  - `@workspace/ui/*` → shared UI components
