# @workspace/browserctl

数字员工内嵌浏览器的命令行客户端。连接 Electron 主进程的本地 bridge：`http://127.0.0.1:34555`，由 Agent 通过 `shell_execute` 调用。

> 私有 workspace 包，**不发布 npm**。零运行时依赖（仅 Node 内置模块）。

## 三种调用场景

| 场景 | 命令 | 说明 |
|------|------|------|
| **Agent（桌面端）** | `browserctl health` | 桌面端启动时 Electron 已把 `packages/browserctl/bin` 注入 `PATH`，裸命令直接可用（见 `apps/web/electron/features/backend/backend-process.ts`） |
| **开发调试** | `pnpm --filter @workspace/browserctl browserctl health` | 脱离桌面端单独调 CLI |
| **直接运行** | `node src/index.js health` 或 `bin/browserctl.cmd health` | 本地脚本 / wrapper |

前置：Electron 桌面端已启动（`pnpm --filter web dev:app`），否则返回 `BRIDGE_CONNECT_FAILED`。

## 命令

```bash
browserctl health
browserctl open <url>                 # = navigate，自动等到 readyState=complete
browserctl snapshot [--max-nodes 200] [--compact|-c] [--depth N|-d N] [--scope <sel>|-s <sel>] [--tree | --interactive]
browserctl wait (--selector <css> [--state visible|hidden] | --text <text> | --url <glob> | --load load|domcontentloaded|networkidle | --fn <js> | --fn-file <path> | --fn-stdin | --ms <n>) [--timeout 10000]
browserctl eval (<js> | --file <path> | --stdin) [--timeout 10000]
browserctl click <@eN|selector> [--confirm "确认文案"]
browserctl fill <@eN|selector> (<text> | --text-file <path> | --text-stdin)
browserctl hover <@eN|selector>            # 鼠标悬停（单次 mouseMoved，不点击）
browserctl dblclick <@eN|selector>         # 双击（clickCount:2）
browserctl focus <@eN|selector>            # 聚焦元素（this.focus()）
browserctl type <@eN|selector> (<text> | --text-file <path> | --text-stdin)  # 追加输入，不清空
browserctl check <@eN|selector>            # 勾选 checkbox/radio
browserctl uncheck <@eN|selector>          # 取消勾选 checkbox
browserctl drag <@eN|selector> <@eN|selector>   # 从 source 拖到 target（10 步插值）
browserctl upload <@eN|selector> <file...> # 给 <input type=file> 设置文件
browserctl get url|title
browserctl get value <@eN|selector>
browserctl get text <@eN|selector>
browserctl is visible|enabled|checked <@eN|selector>
browserctl extract-text
browserctl screenshot [--annotate] [--out <path>]  # 落盘返回 { path, bytes, annotations? }，不输出 base64
browserctl close                      # 关闭内嵌浏览器并收起右栏
```

- `snapshot`：默认 JSON；`--tree` 缩进文本树、`--interactive` 仅可交互节点平铺（省 token）。
- `fill`：文本含引号 / `&` / `|` / 换行等特殊字符时用 `--text-file` / `--text-stdin` 规避命令行 quoting。
- `wait`：操作触发页面变化后，先等关键元素 / 文本，再 `snapshot`。

## 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `BROWSER_RUNTIME_BRIDGE_URL` | `http://127.0.0.1:34555` | bridge 地址 |
| `BROWSER_RUNTIME_SESSION` | `default` | 会话标识（当前仅 `default`） |
| `BROWSER_RUNTIME_TIMEOUT_MS` | `60000` | 单次请求 socket 超时 |
| `BROWSERCTL_PATH` | — | Electron 注入，指向本 CLI 入口（fallback） |

## 错误码

`BRIDGE_CONNECT_FAILED` / `BRIDGE_TIMEOUT` / `BROWSER_UNAVAILABLE` / `BROWSER_VIEWPORT_NOT_READY` / `ELEMENT_NOT_FOUND` / `OPTION_NOT_FOUND` / `NOT_CHECKABLE` / `FILE_NOT_FOUND` / `USER_CANCELLED` / `TIMEOUT` / `EVAL_ERROR` / `EMPTY_SCREENSHOT` / `WRITE_FAILED` / `CLI_USAGE_ERROR`

## 测试

```bash
pnpm --filter @workspace/browserctl test   # 或 cd packages/browserctl && node --test
```

测试用 Node 内置 runner（`node:test`），以临时 mock bridge 覆盖 fill / wait / screenshot / snapshot 文本 / timeout / close 等路径。
