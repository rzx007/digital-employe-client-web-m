# 内嵌浏览器说明

数字员工浏览器不是外部 Chrome，而是 Electron 主窗口右栏中的 `WebContentsView`。

## 与 agent-browser 的差异

| 项 | agent-browser | 数字员工 browser-runtime |
|----|---------------|--------------------------|
| 浏览器宿主 | 独立 Chrome / 云浏览器 | Electron 右栏 `WebContentsView` |
| 调用入口 | `agent-browser` CLI | `browserctl` CLI |
| 会话 | CLI daemon 管理 | Electron 主进程管理 |
| HITL | CLI policy / confirm | 桌面端确认 UI |
| 视口 | 独立浏览器窗口 | React 右栏测量后同步给主进程 |

## 行为约束

- 不要尝试连接外部 CDP 端口。
- 不要绕过 `browserctl` 直接请求 bridge。
- 用户关闭浏览器或切换会话后，内嵌实例会销毁；此时需要重新 `open`。
- 提交类动作必须通过 `--confirm` 触发桌面端确认。

## 推荐节奏

长流程中不要一次性猜测多个页面状态。每次点击导致页面变化后，重新运行：

```bash
browserctl snapshot
```

再继续定位元素。
