// 宿主能力抽象。Electron 实现完整，Standalone 多为简化/no-op。
export interface Host {
  // Electron=原生对话框(内部自管 confirm 期 suppress/restore 可见性)；Standalone=放行+审计日志→true。
  // screenshotBase64 由调用方(createBridge)在 suppress 前截好传入，供对话框预览。
  requestConfirmation(message: string, screenshotBase64?: string): Promise<boolean>
  resolveArtifactPath(nameOrPath: string): string          // screenshot 落盘 / open-artifact 解析
  // navigate 时确保实例存在(Electron 创建 view；Standalone launch/connect)并 attach。
  // 不负责导航本身——导航由 controller.navigate(Page.navigate) 统一做。
  ensureBrowser(url?: string): Promise<void>
  // 每个浏览器 action 前确保 transport 连到当前实例：
  // Electron=拿当前 wc → setWebContents + attach(幂等)，无 wc 抛 BROWSER_UNAVAILABLE；
  // Standalone=no-op(daemon 已常连同一 Chrome)。复刻原 bridge 的 per-action attachDebugger 语义。
  ensureAttached(): Promise<void>
  close(): Promise<void>                                    // 关浏览器实例
  afterClick?(refOrSelector: string): void                 // Electron=flashHighlight(仅 selector)；Standalone no-op
  setActiveSession?(id: string): void                      // Electron 会话归属；Standalone no-op
}
