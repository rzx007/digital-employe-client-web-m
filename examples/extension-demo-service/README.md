# 示例插件 · 含本地服务 (com.example.demo-service)

将 `com.example.demo-service` 目录复制到扩展安装目录：

```text
~/.boban-staff/extensions/com.example.demo-service/
├── digital-employee.extension.json
├── ui/
│   └── index.html
└── service/
    └── server.mjs
```

在数字员工客户端：**设置 → 插件** 中启用并打开。

## 与仅 `ui` 示例的区别

| manifest | 说明 |
|----------|------|
| 仅有 `ui` | 独立 HTML/SPA，见 [`extension-demo`](../extension-demo) |
| `ui` + `service` | 打开窗口前宿主启动 `service` 子进程；插件通过 `getContext().serviceBaseUrl` 访问本地 HTTP API |

是否启服务由 manifest 是否包含 `service` 块决定（勿再使用已废弃的 `kind` 字段）。

启停时机：

- **打开**：`ext:host:open` → 启动服务 → 等待 `ready`（stdout 或 health）→ 创建插件窗口
- **关闭窗口** / `ext:host:close` / 禁用插件 / 退出应用：停止对应子进程

## 要求

- 本机已安装 `node`（在 PATH 中），用于运行 `service/server.mjs`
- 服务仅监听 `127.0.0.1`（manifest `host` 默认）

## manifest `service` 字段摘要

- `command`：argv 数组，禁止 shell 拼接
- `cwd`：相对扩展根目录
- `port: 0`：由宿主分配空闲端口并写入 `envPortKey`（默认 `PORT`）
- `ready`：`stdout` 正则 或 `health` 轮询

详见 [`apps/web/electron/README.md`](../../apps/web/electron/README.md) 插件二期章节。
