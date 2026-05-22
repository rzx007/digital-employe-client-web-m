# 插件示例（Extensions Examples）

本目录为数字员工桌面端**官方插件示例**，用于开发与验收。完整开发规范见 [docs/extension-development-guide.md](../docs/extension-development-guide.md)。

## 安装方式

将 `<id>` 文件夹复制到：

```text
~/.digital-employee/extensions/<id>/
```

或在宿主 **设置 → 插件** 中「从 zip 安装」（zip 内需含 `digital-employee.extension.json`）。

## 示例列表

| 目录 | 插件 ID | 说明 |
|------|---------|------|
| [extension-demo](extension-demo) | `com.example.demo` | 最小 UI 插件 |
| [extension-demo-service](extension-demo-service) | `com.example.demo-service` | UI + 本地 Node service |
| [extension-demo-fetch](extension-demo-fetch) | `com.example.demo-fetch` | `host.network` + 原生 `fetch` |
| [extension-demo-invoke](extension-demo-invoke) | `com.example.demo-invoke` | `extension.invoke` 与宿主事件 |
| [extension-demo-headless](extension-demo-headless) | `com.example.demo-headless` | 仅后台 service（headless） |

各子目录下的 `README.md` 含快速验证步骤。

## 宿主实现

Electron 主进程模块：[apps/web/electron/features/extension/](../apps/web/electron/features/extension/)
