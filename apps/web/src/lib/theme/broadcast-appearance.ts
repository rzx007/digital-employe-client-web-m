import { withElectronApi } from "@/lib/electron/host"

/** 设置窗与主窗独立渲染进程：写 localStorage 后广播，其它窗口重读并 apply。 */
export function broadcastAppearanceChanged(): void {
  void withElectronApi((api) => api.broadcastThemeChanged(), { silent: true })
}
