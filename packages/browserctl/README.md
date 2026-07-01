# @workspace/browserctl

数字员工内嵌浏览器的命令行客户端。连接 Electron 主进程的本地 bridge：`http://127.0.0.1:34555`，由 Agent 通过 `shell_execute` 调用。

> 私有 workspace 包，**不发布 npm**。零运行时依赖（仅 Node 内置模块）。

Agent 侧工作流与防误区见 [`apps/server/build-in-skills/browser-runtime/SKILL.md`](../../apps/server/build-in-skills/browser-runtime/SKILL.md)；命令全集见同目录 [`reference.md`](../../apps/server/build-in-skills/browser-runtime/reference.md)。

## 三种调用场景

| 场景 | 命令 | 说明 |
|------|------|------|
| **Agent（桌面端）** | `browserctl health` | 桌面端启动时 Electron 已把 `packages/browserctl/bin` 注入 `PATH`，裸命令直接可用（见 `apps/web/electron/features/backend/backend-process.ts`） |
| **开发调试** | `pnpm --filter @workspace/browserctl browserctl health` | 脱离桌面端单独调 CLI |
| **独立 Chrome（CI）** | `browserctl open …`（`browserctl-cli` 全局包） | 经 `BROWSER_RUNTIME_BRIDGE_URL` 指向 standalone daemon；见 `packages/browserctl-cli/README.md` |
| **直接运行** | `node src/index.js health` 或 `bin/browserctl.cmd health` | 本地脚本 / wrapper |

前置（桌面端）：Electron 已启动（`pnpm --filter web dev:app`），否则返回 `BRIDGE_CONNECT_FAILED`。

## 命令

```bash
browserctl health
browserctl open <url>                 # = navigate，自动等到 readyState=complete
browserctl open-artifact <文件名或路径>  # 打开会话产物目录 HTML（桌面端专属）
browserctl snapshot [--max-nodes 200] [--compact|-c] [--depth N|-d N] [--scope <sel>|-s <sel>] [--tree | --interactive]
browserctl wait (--selector <css> [--state visible|hidden] | --text <text> | --url <glob> | --load load|domcontentloaded|networkidle | --fn <js> | --fn-file <path> | --fn-stdin | --ms <n>) [--timeout 10000]
browserctl eval (<js> | --file <path> | --stdin) [--timeout 10000]
browserctl click <@eN|selector> [--confirm "确认文案"]
browserctl fill <@eN|selector> (<text> | --text-file <path> | --text-stdin)
browserctl hover <@eN|selector>
browserctl dblclick <@eN|selector>
browserctl focus <@eN|selector>
browserctl type <@eN|selector> (<text> | --text-file <path> | --text-stdin)
browserctl check <@eN|selector>
browserctl uncheck <@eN|selector>
browserctl drag <@eN|selector> <@eN|selector>
browserctl upload <@eN|selector> <file...>
browserctl press <key> [@eN|selector] [--ctrl|--shift|--alt|--meta]
browserctl scroll [@eN|selector] [--to top|bottom] [--by <px>]
browserctl select <@eN|selector> (<value> | --label <文本>)
browserctl get url|title|value|text|attr <@eN|selector> [attrName]
browserctl is visible|enabled|checked <@eN|selector>
browserctl find role|text|…  # positional；或 find <action> --role|--selector|… flag 模式，见 reference.md
browserctl back|forward|reload
browserctl scrollintoview|scroll-into-view <@eN|selector>
browserctl dialog status|accept [text]|dismiss
browserctl extract-text
browserctl screenshot [--annotate] [--out <path>]
browserctl batch [--bail] [--json] "<cmd>" …   # 同进程顺序执行多条子命令
browserctl close                      # 桌面端：关闭内嵌浏览器并收起右栏
```

要点：

- `snapshot`：默认 JSON；`--tree` 缩进文本树、`--interactive` 仅可交互节点（省 token）。
- `fill` / `type`：文本含引号、`&`、`|`、换行等时用 `--text-file` / `--text-stdin`。
- `find`：主 frame 语义/CSS 定位 + 动作，无需先 snapshot；语法见 `reference.md`。
- `batch`：减少 shell 往返；`--bail` 首条失败即停；不可嵌套 `batch`。
- `wait`：操作触发页面变化后，先等关键元素/文本/load，再 `snapshot`。

## 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `BROWSER_RUNTIME_BRIDGE_URL` | `http://127.0.0.1:34555` | bridge 地址 |
| `BROWSER_RUNTIME_SESSION` | `default` | 会话标识（当前仅 `default`） |
| `BROWSER_RUNTIME_TIMEOUT_MS` | `60000` | 单次请求 socket 超时 |
| `BROWSERCTL_PATH` | — | Electron 注入，指向本 CLI 入口（fallback） |

## 错误码

`BRIDGE_CONNECT_FAILED` / `BRIDGE_TIMEOUT` / `BROWSER_UNAVAILABLE` / `BROWSER_ERROR` / `BROWSER_VIEWPORT_NOT_READY` / `ELEMENT_NOT_FOUND` / `OPTION_NOT_FOUND` / `NOT_CHECKABLE` / `FILE_NOT_FOUND` / `USER_CANCELLED` / `TIMEOUT` / `EVAL_ERROR` / `DIALOG_NOT_PENDING` / `EMPTY_SCREENSHOT` / `WRITE_FAILED` / `CLI_USAGE_ERROR`

## 测试

```bash
pnpm --filter @workspace/browserctl test   # 或 cd packages/browserctl && node --test
```

测试用 Node 内置 runner（`node:test`），以临时 mock bridge 覆盖 fill / wait / screenshot / snapshot / find / batch 等路径。
