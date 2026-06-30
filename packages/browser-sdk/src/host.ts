// 宿主能力抽象。Electron 实现完整，Standalone 多为简化/no-op。
export interface Host {
  // Electron=原生对话框(内部自管 confirm 期 suppress/restore 可见性)；Standalone=放行+审计日志→true。
  // screenshotBase64 由调用方(createBridge)在 suppress 前截好传入，供对话框预览。
  requestConfirmation(message: string, screenshotBase64?: string): Promise<boolean>
  resolveArtifactPath(nameOrPath: string): string          // screenshot 落盘 / open-artifact 解析
  ensureBrowser(url?: string): Promise<void>               // open/navigate 前确保实例就绪并 attach transport
  close(): Promise<void>                                    // 关浏览器实例
  afterClick?(refOrSelector: string): void                 // Electron=flashHighlight(仅 selector)；Standalone no-op
  setActiveSession?(id: string): void                      // Electron 会话归属；Standalone no-op
}
