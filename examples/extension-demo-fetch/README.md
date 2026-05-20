# extension-demo-fetch

五期示例：通过宿主 `extension.fetch` 访问 manifest `network.allowlist` 中的域名。

## 安装

复制 `com.example.demo-fetch` 到 `~/.digital-employee/extensions/`，或在设置页「从 zip 安装」。

## 验证

1. 启用并打开插件
2. 点击「合法请求」→ 应返回 JSON（status 200）
3. 点击「被拦截」→ 应报错 `Host not in network.allowlist`
