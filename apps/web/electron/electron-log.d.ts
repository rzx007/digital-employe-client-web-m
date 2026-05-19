/**
 * electron-log 未为 preload 子路径提供 types（package exports 仅指向 .js）
 * @see https://github.com/megahertz/electron-log
 */
declare module "electron-log/preload" {
  interface PreloadLogger {
    error(...args: unknown[]): void
    warn(...args: unknown[]): void
    info(...args: unknown[]): void
    debug(...args: unknown[]): void
    verbose(...args: unknown[]): void
    silly(...args: unknown[]): void
  }

  const log: PreloadLogger & { default: PreloadLogger }
  export = log
}
