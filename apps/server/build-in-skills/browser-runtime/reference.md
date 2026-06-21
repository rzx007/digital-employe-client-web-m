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
| `BRIDGE_TIMEOUT` | 请求超时（默认 60s，`BROWSER_RUNTIME_TIMEOUT_MS` 可调） |
| `BROWSER_UNAVAILABLE` | 内嵌浏览器实例不可用 |
| `BROWSER_VIEWPORT_NOT_READY` | 右栏视口尚未完成布局 |
| `ELEMENT_NOT_FOUND` | 元素引用或选择器未找到 |
| `USER_CANCELLED` | 用户取消确认 |
| `TIMEOUT` | 操作超时（含 `wait` 超时） |
| `EMPTY_SCREENSHOT` | 截图数据为空 |
| `WRITE_FAILED` | 截图写盘失败 |
| `MISSING_CONVERSATION_ID` | `open-artifact` 缺会话标识（shell 未注入 `CONVERSATION_ID`） |
| `CANNOT_RESOLVE_PATH` | `open-artifact` 给纯文件名但 `$ARTIFACTS_DIR` 未注入；改用绝对路径，或在产物目录 cwd 下。会话目录外的文件由后端 404（先复制进产物目录再打开） |

## ⚠️ 关键约定：不要把 `health` 当门禁

`browserctl health` 的 `browser_available` 字段表示**此刻内嵌浏览器实例是否已存在**，
而**不是**「浏览器能否使用」。内嵌浏览器是惰性创建的：只有 `open` / `navigate` 才会
创建它，`health` 自己**永远不会**创建。

因此存在一个完全正常、并非故障的情况：

- 当任务**由组长/总管派单**（离屏后台会话）或用户停在别的会话时，浏览器尚未创建，
  `health` 会如实返回 `browser_available: false`、`url: ""`。
- 此时**直接 `browserctl open <url>` 即可**——`open` 会走离屏兜底分支创建浏览器并完成
  导航（视图保持不可见，用户切回该会话时自动摊开）。

**绝对不要**因为 `health` 返回 `browser_available: false` 就判定浏览器不可用、转去用
Python/requests 抓页面。那是误判：`open` 仍会成功。只有当 `open` / `navigate` 本身返回
`ok:false`（如 `BROWSER_UNAVAILABLE`、`BRIDGE_CONNECT_FAILED`）时才说明浏览器真的不可用。

> 正确流程：**直接 `open`** →（按需 `wait`）→ `snapshot` / `extract-text`。
> `health` 仅用于排查 bridge 连通性，**不是**使用浏览器前的必经检查。

## 命令

```bash
browserctl health
browserctl open <url>
browserctl navigate <url>
browserctl open-artifact <文件名或真实路径>   # 打开会话产物目录里的 HTML（纯文件名按 $ARTIFACTS_DIR 解析，自动识别会话，支持相对资源），无文件卡片时用
browserctl snapshot [--max-nodes 200] [--tree|--interactive]   # 文本模式省 token；--interactive 仅可交互节点平铺，--tree 全量缩进树，默认 JSON
browserctl click <@eN|selector> [--confirm "确认文案"]
browserctl wait --selector <css>     # 等元素出现（默认超时 10s，--timeout 改）
browserctl wait --text <文本>        # 等文本出现在页面
browserctl wait --ms <毫秒>          # 固定等待（无明确目标时兜底）
browserctl fill <@eN|selector> <text>
browserctl fill <@eN|selector> --text-file <path>   # 文本含引号/&/|/空格/换行等特殊字符时优先用
browserctl fill <@eN|selector> --text-stdin          # 从管道读取文本（echo ... | browserctl fill ...）
browserctl get url
browserctl get title
browserctl get-url
browserctl get-title
browserctl extract-text
browserctl screenshot [--out <path>]   # 截图落盘到产物目录，返回 { path, bytes }，不输出 base64
browserctl close                       # 关闭内嵌浏览器并收起右栏（任务结束释放资源）
```

> `screenshot` 默认写到当前会话产物目录 `browser-screenshot-<时间戳>.png`，或用 `--out` 指定路径。返回文件路径后，如需让模型查看可再 `read` 该图片。

## 调用方式

桌面端（`pnpm dev:app` 或打包版）启动时，Electron 会向后端进程注入环境，使 `browserctl` 直接在 `shell_execute` 的 PATH 中可用——**主路径就是裸命令** `browserctl <子命令>`。

注入内容（见 `apps/web/electron/features/backend/backend-process.ts`）：

- `PATH` 前置 `packages/browserctl/bin`（含 `browserctl.cmd` / `browserctl` wrapper）→ **主路径就是裸命令 `browserctl <子命令>`，跨平台一致，优先用它**
- `BROWSERCTL_PATH` 指向 CLI 入口绝对路径，**仅供人工排查，勿作为默认命令模板**（环境变量引用语法分平台，Agent 照抄易错）：
  - Windows cmd：`node "%BROWSERCTL_PATH%" health`
  - macOS / Linux：`node "$BROWSERCTL_PATH" health`

> 命令带空格参数时务必加引号，例如 `browserctl fill @e4 "数字 员工"`；wrapper 以 `%*` / `"$@"` 原样透传。

仅当脱离桌面端单独调试 CLI 时，在仓库内用 pnpm workspace 调用：

```bash
pnpm --filter @workspace/browserctl browserctl health
```

## 元素引用

`browserctl snapshot` 返回来自可访问性树的 `@eN` 引用。页面跳转、刷新、弹窗、表单联动后引用可能失效，需要重新 snapshot。

优先使用 `@eN`，选择器仅在稳定页面结构中使用。
