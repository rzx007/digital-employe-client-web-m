// CDP 收发抽象。Electron(webContents.debugger) / 独立 Chrome(CDP-over-WS) 各一实现。
export interface Transport {
  attach(): Promise<void>
  detach(): Promise<void>
  sendCommand(method: string, params?: Record<string, unknown>): Promise<unknown>
  isAttached(): boolean
  // 预留 OOPIF auto-attach（本期可空实现）
  on(event: "message", cb: (method: string, params: unknown, sessionId?: string) => void): void
}
