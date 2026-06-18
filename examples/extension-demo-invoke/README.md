# 示例插件 · invoke / 宿主事件 (com.example.demo-invoke)

将 `com.example.demo-invoke` 复制到：

```text
~/.boban-staff/extensions/com.example.demo-invoke/
├── digital-employee.extension.json
└── ui/index.html
```

启用并打开插件窗口，可测试 `extension.invoke` 与 `onHostEvent`。

在 **设置 → 插件** 点击「发送测试事件」，已打开且声明 `host.events` 的插件会收到事件。

## permissions 与方法

| permission | invoke 方法 |
|------------|-------------|
| `host.notification` | `notification.show` |
| `host.window.main` | `window.focusMain` |
| `host.storage` | `storage.get` / `storage.set` |
| `host.backend.read` | `backend.getPort` |
| `host.events` | `onHostEvent` |

详见 [`apps/web/electron/README.md`](../../apps/web/electron/README.md) 四期章节。
