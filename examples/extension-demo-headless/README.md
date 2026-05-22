# 示例插件 · Headless (com.example.demo-headless)

仅含 `service` 块、无 `ui`。启用后由宿主自动启动子进程，**不会**打开插件窗口。

```text
~/.digital-employee/extensions/com.example.demo-headless/
├── digital-employee.extension.json
└── service/
    └── server.mjs
```

在数字员工客户端：**设置 → 插件** 中启用；列表显示「后台服务」与运行状态，无「打开」按钮。

## 要求

- 本机已安装 `node`（PATH 可执行）
- 服务监听 `127.0.0.1`（manifest `host` 默认）

## 与其它示例

| 示例 | manifest |
|------|----------|
| [extension-demo](../extension-demo) | 仅 `ui` |
| [extension-demo-service](../extension-demo-service) | `ui` + `service` |
| 本目录 | 仅 `service` |

详见 [`apps/web/electron/README.md`](../../apps/web/electron/README.md) 插件三期章节。
