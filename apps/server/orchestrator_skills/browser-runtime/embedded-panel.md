# 内嵌浏览器说明

数字员工浏览器默认不是外部 Chrome，而是 Electron 主窗口右栏中的 `WebContentsView`。命令逻辑已抽成与宿主无关的 SDK，**同一套 `browserctl` 命令也能驱动独立 Chrome/Edge**（开发/CI 场景，见 [reference.md](reference.md) 末尾「独立后端」）；员工日常仍是桌面端内嵌浏览器。

## 与 agent-browser 的差异

| 项 | agent-browser | 数字员工 browser-runtime |
|----|---------------|--------------------------|
| 浏览器宿主 | 独立 Chrome / 云浏览器 | Electron 右栏 `WebContentsView`（默认）或独立 Chrome/Edge daemon |
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
