# browserctl 命令参考

`browserctl` 是数字员工内嵌浏览器的命令行入口。它连接 Electron 主进程的本地 bridge：`http://127.0.0.1:34555`。

## 输出格式

所有命令默认输出 JSON：

```json
{
  "ok": true,
  "data": {}
}
```

失败时：

```json
{
  "ok": false,
  "error": "BROWSER_UNAVAILABLE",
  "code": "BROWSER_UNAVAILABLE"
}
```

常见错误码：

| code | 含义 |
|------|------|
| `BRIDGE_CONNECT_FAILED` | 无法连接 Electron bridge |
| `BROWSER_UNAVAILABLE` | 内嵌浏览器实例不可用 |
| `BROWSER_VIEWPORT_NOT_READY` | 右栏视口尚未完成布局 |
| `ELEMENT_NOT_FOUND` | 元素引用或选择器未找到 |
| `USER_CANCELLED` | 用户取消确认 |
| `TIMEOUT` | 操作超时 |

## 命令

```bash
browserctl health
browserctl open <url>
browserctl navigate <url>
browserctl snapshot [--max-nodes 200]
browserctl click <@eN|selector> [--confirm "确认文案"]
browserctl fill <@eN|selector> <text>
browserctl get url
browserctl get title
browserctl get-url
browserctl get-title
browserctl extract-text
browserctl screenshot
```

## 开发环境调用

如果 `browserctl` 不在 PATH 中，在仓库内用 pnpm workspace 调用：

```bash
pnpm --dir "<workspace-root>" --filter @workspace/browserctl browserctl health
```

将 `<workspace-root>` 替换为项目根目录。

## 元素引用

`browserctl snapshot` 返回来自可访问性树的 `@eN` 引用。页面跳转、刷新、弹窗、表单联动后引用可能失效，需要重新 snapshot。

优先使用 `@eN`，选择器仅在稳定页面结构中使用。
