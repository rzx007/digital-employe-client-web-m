# browserctl-cli 全局发布包 — 设计

- 日期：2026-06-30
- 状态：设计与用户逐节确认，待 spec review
- 分支：`feat/browserctl-cli-package`

## 背景与目标

SDK 双后端重构已落地（`@workspace/browser-sdk` 命令逻辑 + `@workspace/browserctl-daemon` 独立 Chrome/Edge daemon + `@workspace/browserctl` CLI）。现在要把"独立后端"打包成一个**自包含、可全局使用的 CLI 工具**，给**非 Electron 环境**（CI、开发者、本地自动化 OA 流程）用。

**目标**：

- 新建 `packages/browserctl-cli` 发布壳包，用 `tsup` 把 cli 命令 + daemon + sdk 编译进**自包含 dist**；`chrome-launcher`/`chrome-remote-interface` 作为运行时依赖。
- **auto-start daemon**（对标 agent-browser）：CLI 命令自动在后台拉起并复用 daemon，用户无感。
- **本地全局可用**：bin wrapper 加 PATH（或 `pnpm link --global`），任何目录 `browserctl open ...`。
- monorepo 内部三个包**原样不动**，Electron 桌面端零影响（仍用内部包 + 启动注入）。

## 非目标（暂缓 / 后续）

- **npm publish**：本次只 build dist + 本地全局可用，**不实际发布**。保留 `private: true`。发布所需的去 private / `publishConfig` / README / LICENSE 留口，等将来要发时一步补。
- **多会话隔离**（agent-browser 的 `--session`）：MVP 单 daemon、单 Chrome、单端口。
- 改动 monorepo 内部三包的对外行为（只可能为"命令逻辑可复用"做最小重构，见下）。

## 架构

```
packages/browserctl-cli/            ← 新建，发布壳包
  package.json    name: browserctl-cli, bin: { browserctl: "dist/cli.js" }, private: true
                  dependencies: chrome-launcher, chrome-remote-interface
                  files: ["dist", "bin"]
  tsup.config.ts  两入口 → dist/cli.js, dist/daemon.js；external: chrome-launcher/cri
  tsconfig.json
  bin/
    browserctl.cmd    Windows wrapper → node "%~dp0..\dist\cli.js" %*
    browserctl        *nix wrapper    → exec node "$DIR/../dist/cli.js" "$@"
  src/
    cli.ts            CLI 入口：ensureDaemon() + 复用命令分发
    daemon-manager.ts auto-start：状态文件 / ensureDaemon / spawn detached / quit
    daemon-entry.ts   daemon 入口（复用 browserctl-daemon launch+createBridge）
  README.md
  dist/               build 产物（git 忽略或不提交）
```

**bundler = tsup**（esbuild 内核）：

- 两个产物：`dist/cli.js`（bin）、`dist/daemon.js`（CLI spawn 的后台进程）。
- **workspace 依赖内联**：`@workspace/browser-sdk` + `@workspace/browserctl-daemon` 的代码被 bundle 进 dist，发布包自包含、不依赖 monorepo。
- **`chrome-launcher` / `chrome-remote-interface` 标 external**，作为包 `dependencies`（运行时从包 `node_modules` 解析）——它们较重 / 有动态加载，bundle 进去风险大。

**命令逻辑复用（不重复）**：

- 现 `packages/browserctl/src/index.js` 的命令分发在 **`run(argv)`** 里（已有 `invokedDirectly`/`import.meta.url` guard 隔离入口与 import，已导出 parseFlags/resolveSession 等）。**最小重构**：`export` 出 `run`，并把内部 `bridgeUrl()` helper 从闭包 `DEFAULT_BASE_URL` 改成接受 `baseUrl` 参数（`run(argv, baseUrl?)`）。`cli.ts` 在外面包 `ensureDaemon()` 拿到 daemon 的 baseUrl，再调 `run(argv, baseUrl)`。Electron 直接跑 index.js 的用法不受影响（guard 隔离）。
- `daemon-entry.ts` 复用 daemon 的 launch+createBridge。但 daemon 的 launch 逻辑现全在 `main()` 内、未导出——同样做**最小重构**：给 `packages/browserctl-daemon/src/index.ts` 抽出导出的 `startDaemon(args)`（原 main 调它），`daemon-entry.ts` import 它（避免复制 ~30 行 launch 序列）。

即：内部三包是"源"，browserctl-cli 是把它们 bundle + 加 auto-start 的发布壳。

## auto-start daemon

**状态文件** `~/.browserctl/daemon.json`：
```json
{ "port": 34555, "pid": 12345, "browser": "chrome", "startedAt": <ts> }
```

**`ensureDaemon()`**（`daemon-manager.ts`，CLI 每条浏览器命令前调）：
```
读 daemon.json（若有）
GET http://127.0.0.1:<port>/internal/browser/health
  ├─ 通  → 返回 baseUrl，直接发命令
  └─ 不通 / 无状态：
        port = 34555 占用则找空闲端口
        spawn(process.execPath, [daemonJsPath, "--browser", "chrome", "--port", port],
              { detached: true, stdio: "ignore" }).unref()
        轮询 health 直到就绪（含 Chrome launch，超时 ~15s）
        写 daemon.json
        返回 baseUrl
```

**要点**：

- **detached + unref**：daemon 脱离 CLI 后台持久，跨命令复用同一 Chrome 与登录态（agent-browser 体验）。
- **默认配置**：auto-start 默认 `chrome + 有头 + 持久 profile`(`~/.browserctl/profile-chrome`)。要 edge/headless 先 `browserctl serve --browser edge --headless` 显式起，auto-start 检测到已有 daemon 即复用。
- **端口**：默认 34555；占用则自动找空闲端口并写状态。
- **stale 自愈**：状态在但 health ping 不通（pid 死）→ 当未跑，重新 spawn。

**生命周期命令**：

| 命令 | 行为 |
|---|---|
| `browserctl open/snapshot/...` | 前置 `ensureDaemon()`，自动起 / 复用 |
| `browserctl serve [--browser/--headless/...]` | 显式**前台**起 daemon（调试 / 换非默认配置；Ctrl+C 停） |
| `browserctl quit` | 读状态 → kill daemon pid → 关 Chrome → 删状态 |
| `browserctl close` | 现有语义：关当前浏览器页 / 释放（daemon 留着） |

## build + 本地全局可用

**build**：`pnpm --filter browserctl-cli build`（跑 tsup）→ `dist/cli.js` + `dist/daemon.js`。

**全局可用（两种，任选）**：

1. **bin wrapper + PATH**（对应"全局环境变量"）：把 `packages\browserctl-cli\bin` 加进系统 PATH → 任何目录 `browserctl <cmd>`。复用现有 `packages/browserctl/bin/browserctl.cmd` 模式。
2. **`pnpm --filter browserctl-cli link --global`**：pnpm 全局链接 bin，一条命令等效。

依赖解析：`chrome-launcher`/`cri` 在包 `node_modules`（`pnpm install` 后由 workspace 解析）。daemon spawn 时从包 dist 同级 `node_modules` resolve。

## 错误处理

- daemon spawn 后 health 超时 → 报错 + 提示看 daemon 日志（可选 `~/.browserctl/daemon.log`）。
- Chrome 找不到 → daemon 退出，CLI ensureDaemon 超时报清晰错误（提示 `--executable` / 装 Chrome）。
- 端口冲突 → 自动换端口；写状态。
- chrome-launcher SingletonLock 残留 → daemon 启动已自动清理（前序 fix 已加）。

## 测试

- **daemon-manager 单测**（mock）：状态文件读写、stale 检测逻辑、端口选择（不真 spawn）。
- **build 冒烟**：`pnpm --filter browserctl-cli build` 产出 dist；`node dist/cli.js --version` 可跑。
- **端到端冒烟（手动 / 脚本）**：bin 加 PATH 后 `browserctl open https://www.baidu.com`（auto-start 拉起 daemon+Chrome）→ `snapshot` 拿到 @eN → `browserctl quit` 停。
- 复用的内部包测试不受影响（browser-sdk 13 / daemon 6 仍绿）。

## 受影响 / 新增文件

| 路径 | 动作 |
|---|---|
| `packages/browserctl-cli/*` | 新建：package.json / tsup.config / tsconfig / bin/* / src/*（cli, daemon-manager, daemon-entry）/ README |
| `packages/browserctl/src/index.js` | 最小重构：export `run`，`bridgeUrl()` helper 接受 `baseUrl` 参数（行为不变，guard 隔离 Electron 用法） |
| `packages/browserctl-daemon/src/index.ts` | 最小重构：抽出导出的 `startDaemon(args)`（原 main 调它），供 daemon-entry 复用 |
| 根 `pnpm-workspace` / lockfile | 新包 + chrome-launcher/cri 依赖（已在 daemon 装过，复用版本） |

## 风险与 spike

- **tsup 内联 workspace 依赖**：daemon/sdk 用 NodeNext `.js` 扩展 import（`./chrome-transport.js` 等）；确认 tsup 的 `noExternal`/内联能正确解析这些，external 列表正确排除 chrome-launcher/cri。**首次 build 后立即冒烟** `node dist/daemon.js --help`（或 `--version`）验证内联无缺。
- **detached spawn 跨平台**：Windows 下 `detached: true` + `.unref()` 的后台行为（Windows 无真正 daemonize，detached 创建新进程组；验证 CLI 退出后 daemon 存活）。
- **命令逻辑复用重构**：`packages/browserctl/src/index.js` 抽 `runCommand` 不破坏现有桌面端用法（Electron 注入仍直接跑 index.js main）。
- **bin wrapper 解析**：全局 PATH 下 wrapper → dist/cli.js → spawn dist/daemon.js → resolve chrome-launcher，路径在 link/PATH 两种方式下都成立。
