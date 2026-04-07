# Agents Guide

This monorepo is a React 19 + TypeScript web dashboard built with Vite, Turbo, and TanStack Router.

## Project Structure

- `apps/web` - Main application with TanStack Router and React Query
- `packages/ui` - Shared UI components built with Radix UI and Tailwind CSS

## Build & Development Commands

```bash
# Build all packages
turbo build

# Development mode (all packages)
turbo dev

# Lint all packages
turbo lint

# Format all packages
turbo format

# Type check all packages
turbo typecheck

# Run commands for specific package
turbo lint --filter=web
turbo build --filter=@workspace/ui
```

Note: No test framework is currently configured. When adding tests, set up Vitest or Jest.

## Code Style Guidelines

### Imports

Import order (grouped, sorted within groups): React and external packages, local components, utils/hooks/types.

```typescript
import * as React from "react"
import { Link } from "@tanstack/react-router"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
```

### Component Structure

Use named exports. Add `` directive only for client-side interactivity.

```typescript

import * as React from "react"

export function MyComponent({ prop }: MyComponentProps) {
  return <div>...</div>
}
```

### TypeScript

Strict mode enabled. Use `React.ComponentProps` for spreading native element props. Use `VariantProps` from class-variance-authority for variant types.

```typescript
function Button({
  className,
  variant,
  ...props
}: React.ComponentProps<"button"> & {
  variant?: "default" | "outline"
}) {
  return <button className={cn(variants({ variant, className }))} {...props} />
}
```

### Styling with Tailwind CSS

Use `cn()` utility for merging Tailwind classes. Use `cva()` for component variants. Prefer data attributes over arbitrary values for theming.

```typescript
const variants = cva("base-classes", {
  variants: {
    size: { default: "h-8", sm: "h-6" }
  },
  defaultVariants: { size: "default" }
})
```

### Naming Conventions

- **Components**: PascalCase (`AppSidebar`, `Button`)
- **Hooks**: camelCase with `use` prefix (`useIsMobile`)
- **Utilities**: camelCase (`cn`, `formatDate`)
- **Constants**: UPPER_SNAKE_CASE (`MOBILE_BREAKPOINT`)
- **Interfaces/Types**: PascalCase (`ButtonProps`, `VariantProps`)

### Error Handling

Use error boundaries for component errors. For TanStack Query, use `useErrorBoundary` hook or error boundaries.

### Formatting

- **No semicolons** (Prettier rule)
- **Double quotes** for strings
- **Trailing commas** in objects and arrays
- **2 space indentation**
- **80 character line width**

Running `turbo format` applies Prettier automatically. The codebase uses prettier-plugin-tailwindcss to sort Tailwind classes.

### ESLint & TypeScript

Run `turbo typecheck` before committing. Uses TypeScript ESLint with `typescript-eslint`, `eslint-plugin-react-hooks`, and `eslint-plugin-react-refresh`.

Always run `turbo lint` and `turbo typecheck` to ensure code quality.

### Key Libraries

- **Router**: TanStack Router - file-based routing with type-safe navigation
- **State**: TanStack Query - server state management
- **UI**: Radix UI primitives, shadcn/ui patterns
- **Icons**: Tabler Icons via `@tabler/icons-react`
- **Styling**: Tailwind CSS v4, class-variance-authority
- **Utilities**: clsx, tailwind-merge, ahooks

### Radix UI Patterns

Use the `asChild` pattern for composability when rendering Radix UI components as custom elements:

```typescript
<Button asChild>
  <Link to="/path">Click me</Link>
</Button>
```

### TanStack Router

Define routes using `createFileRoute`:

```typescript
import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/")({
  component: Index,
})
```

### Workspace Package Usage

Import from workspace packages using the configured path aliases:

```typescript
// From apps/web, import UI components:
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
```

Path aliases are defined in each package's tsconfig.json:

- `@/*` → `./src/*` (in apps/web)
- `@workspace/ui/*` → `../../packages/ui/src/*` (in apps/web)
- `@workspace/ui/*` → `./src/*` (in packages/ui)
