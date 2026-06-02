# 内嵌浏览器（BrowserPanel + WebContentsView）

聊天右栏 `BrowserPanel` 通过主进程 `BrowserWindowController` 将独立会话的 `WebContentsView` 叠在 React 视口上；Agent 经本地 HTTP（34555）+ CDP 操作同一 `webContents`。

## 文件

| 文件 | 职责 |
|------|------|
| `window-controller.ts` | 视口布局、`WebContentsView` 生命周期、URL/错误 IPC |
| `viewport-bounds.ts` | DOM 测量脚本、CSS px → DIP |
| `browser-http-bridge.ts` | Agent 本地 HTTP |
| `browser-debugger-controller.ts` | CDP |
| `preload-bridge.ts` | `browser.syncBounds` 等 |

渲染进程：`src/components/chat/right-panels/browser-panel.tsx`（`data-browser-viewport` / `data-browser-footer`）、`src/hooks/use-browser-viewport-sync.ts`、`src/lib/browser/viewport-bounds.ts`。

## 正确架构（勿回退）

```
main.contentView
  └── View（容器，setBounds = 对齐 [data-browser-viewport] 的 DIP 矩形）
        └── WebContentsView（浏览器页，setBounds 恒为 { x:0, y:0, width, height }）
```

- 使用 **[WebContentsView](https://www.electronjs.org/zh/docs/latest/api/web-contents-view)**，不要用已废弃的 `BrowserView`。
- **不要**用 `parent` 子 `BrowserWindow` 贴主窗（Windows 上 `setBounds` 与页面 `getBoundingClientRect` 易不一致）。
- **不要**把浏览器 `WebContentsView` 直接 `setBounds({ x:552, … })` 且让网页内容在 View 内再偏一截——会出现左侧浅蓝空白（`setBackgroundColor`），应使用上文的**容器 + 子 View 原点 (0,0)**。
- Electron 41 **无** `view.setZIndex()`；置顶用 `contentView.removeChildView` + `addChildView`（容器在最后 add）。

## 视口测量

1. 只对齐 `[data-browser-viewport]`，不要量整个右栏或 `data-browser-panel`。
2. **高度** = `footer.getBoundingClientRect().top - viewport.top`，避免盖住底部 URL 栏（`data-browser-footer`）。
3. 渲染进程 `useBrowserViewportSync` 通过 IPC 上报 **CSS 像素**；主进程在 `pullBoundsFromDom` / `syncBounds` 中乘以 `main.webContents.getZoomFactor()` 再 `setBounds`（**DIP**）。漏乘 zoom 会导致整体偏右下、左侧露浅蓝条。

## 布局时序

- `open()` 时先 `setVisible(false)`，待视口 ≥ 40px 且 DOM 连续两次测量一致后再 `loadURL`，避免首帧 `y` 跳动（如 93→110）时抢先导航。
- 主进程 `resize` / `move` 会 `executeJavaScript` 再测一次，与渲染进程规则一致。

## 面板生命周期

- **最小化**：调用 `browser.hide()`，只隐藏右栏 panel，保留 `WebContentsView`、当前 URL 与会话状态；会话页右边缘显示悬浮浏览器图标用于恢复。
- **关闭（X）**：首次会弹出确认（可勾选「不再提醒」）；弹窗期间会 `browser.hide()` 隐藏原生 `WebContentsView`（否则盖住 React `AlertDialog`），取消后 `browser.show()` 恢复。
- **切换对话 / 离开聊天页**：主动执行关闭销毁，避免浏览上下文跨会话泄露。
- `AppToolbar` 不提供浏览器入口；浏览器只由对话/Agent 工具唤醒。

## Agent HTTP 桥接（34555）

- `POST /internal/browser/default/navigate`：先 `browser:request-open` 打开右栏，再 `prepareViewportForBridge()` 轮询视口，最后 `loadURL` + 等待 `did-finish-load`。
- Python `BrowserRuntimeClient.navigate` 使用 **55s** 超时（与 Electron 45s 加载等待匹配）；勿用默认 30s，否则客户端会先断开并出现「空响应 HTTP 502」。
- Python `BrowserRuntimeClient` 必须 `trust_env=False` 直连本机 bridge；`httpx` 默认会读取 Windows/系统代理配置，可能把 `127.0.0.1:34555` 发到代理并得到**空 502**。
- 勿在桥接里先 `open()` 再 `notifyRequestOpen()` 重复打开，也勿在视口未就绪时用 `!isLoading()` 误判导航完成。

## 修改后自检

1. 完全退出 Electron（含托盘），`pnpm dev:client` 或 `dev:app`。
2. 打开右栏浏览器，访问 `https://www.baidu.com`。
3. 网页左缘与灰色视口左缘对齐，无浅蓝竖条；底部 `https://…` 状态栏可见。
4. 拖拽 `BrowserWidthSlider`、缩放窗口后仍对齐。

## 常见误区（历史踩坑）

| 做法 | 后果 |
|------|------|
| 子 `BrowserWindow` + parent | 能加载但 Windows 上错位 |
| 仅 `contentView.addChildView(browserView)` 且 bounds=CSS px | 缩放≠1 时偏右下、浅蓝条 |
| `bounds.x/y` 加减 `contentView` 或 host 偏移 | Windows 上二次偏移 |
| `height = rect.height - footerHeight` 常量扣减 | 与真实 footer 位置不符，压住底栏 |
| 过早 `loadURL` | 首帧 bounds 错误 |
| `setZIndex` | Electron 41 报错 |
