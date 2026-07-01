# extension-demo-fetch

示例：插件 UI 使用原生 `fetch`，出站由宿主 `session.webRequest` 按 manifest `network.allowlist` 拦截。

## 安装

复制 `com.example.demo-fetch` 到 `~/.boban-staff/extensions/`，或在设置页「从 zip 安装」。

## 验证

1. 启用并打开插件
2. 点击「合法请求」→ 应返回 JSON（status 200）
3. 点击「被拦截」→ 应失败（请求被 webRequest 取消，如 `Failed to fetch` / `ERR_BLOCKED`）
