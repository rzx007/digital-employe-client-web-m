// 宿主能力抽象。Electron 实现完整，Standalone 多为简化/no-op。
export interface Host {
  requestConfirmation(message: string): Promise<boolean>  // Electron=原生对话框；Standalone=放行+审计日志→true
  resolveArtifactPath(nameOrPath: string): string          // screenshot 落盘 / open-artifact 解析
  ensureBrowser(url?: string): Promise<void>               // open/navigate 前确保实例就绪并 attach transport
  close(): Promise<void>                                    // 关浏览器实例
  beforeInteraction?(): void                               // Electron=confirm 期 suppress 可见性；Standalone no-op
  afterClick?(refOrSelector: string): void                 // Electron=flashHighlight；Standalone no-op
  setActiveSession?(id: string): void                      // Electron 会话归属；Standalone no-op
}
