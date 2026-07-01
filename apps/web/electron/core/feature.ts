import type { AppContext } from "./app-context"

/**
 * 内置 Feature / 未来 Extension 共用激活接口
 */
export interface Feature {
  readonly id: string
  activate(ctx: AppContext): void | Promise<void>
  deactivate?(): void
}
