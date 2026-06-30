# browserctl-cli 全局发布包 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新建 `packages/browserctl-cli`——用 tsup 把 browserctl 命令逻辑 + daemon + sdk 编译进自包含 dist 的全局 CLI,带 auto-start daemon,本地全局可用(npm publish 暂缓)。

**Architecture:** 壳包用 tsup 内联 `@workspace/browser-sdk`/`browserctl-daemon`/`browserctl` 的代码,`chrome-launcher`/`chrome-remote-interface` 留 external 作 deps。CLI 每条命令前 `ensureDaemon()` 自动后台拉起/复用 detached daemon(状态文件 `~/.browserctl/daemon.json`)。内部三包只做导出 `run`/`startDaemon` 的最小重构。

**Tech Stack:** tsup(esbuild), Node child_process(detached spawn), chrome-launcher + chrome-remote-interface, node:test + tsx。

**Spec:** [docs/superpowers/specs/2026-06-30-browserctl-cli-package-design.md](../specs/2026-06-30-browserctl-cli-package-design.md)

**分支:** `feat/browserctl-cli-package`

**约定:** 子代理只 `git add` 自己明确列出的文件,**禁止** `git add .` / `-A` / `git commit -a`。工作树里 `apps/server/orchestrator_skills/browser-runtime/*` 有他人/reconcile 的未提交改动——**不要碰**。

**测试运行:** `cd packages/browserctl-cli && npx tsx --test test/*.test.ts`;build:`pnpm --filter browserctl-cli build`。

---

## Phase 1 — 内部包最小重构(导出可复用入口)

### Task 1.1: browserctl 导出 `run(argv, baseUrl?)`

让 `packages/browserctl/src/index.js` 的命令分发可被壳包复用,且 baseUrl 可由调用方覆盖。

**Files:**
- Modify: `packages/browserctl/src/index.js`
- Modify: `packages/browserctl/package.json`（加 `exports`——**必做**，否则壳包 import 不到）

- [ ] **Step 1: 改 bridgeUrl 用可变 activeBaseUrl**

定位 `bridgeUrl()` helper(在 `DEFAULT_BASE_URL` 常量附近)。新增模块级 `let activeBaseUrl = DEFAULT_BASE_URL`,把 `bridgeUrl` 内部对 `DEFAULT_BASE_URL` 的引用改为 `activeBaseUrl`。`requestJson` 的错误信息里 `DEFAULT_BASE_URL` 也改 `activeBaseUrl`。

- [ ] **Step 2: run 接受 baseUrl 并导出**

`async function run(argv)` → `async function run(argv, baseUrl)`;函数体最前面加:
```js
if (baseUrl) activeBaseUrl = baseUrl
```
文件末尾(invokedDirectly guard 附近)加导出:
```js
export { run }
```
`invokedDirectly` 分支保持 `run(process.argv.slice(2))`(不传 baseUrl,用默认 env/常量)——**Electron 注入用法完全不变**。

> 模块级 `activeBaseUrl` 是有意的:CLI 每次进程只跑一条命令,无并发问题。

- [ ] **Step 2b: 给 browserctl/package.json 加 exports(必做)**

`packages/browserctl/package.json` 当前只有 `bin`,没有 `exports`/`main`。壳包 `import { run } from "@workspace/browserctl"` 在 tsup 解析必须靠它:
```json
"exports": { ".": "./src/index.js" }
```
(加在 package.json 顶层,与 `bin` 平级。)

- [ ] **Step 3: 验证现有用法不破坏**

Run: `cd packages/browserctl && node src/index.js --version`
Expected: 打印版本号(说明直接入口仍工作)。
Run: `cd packages/browserctl && node --test 2>&1 | tail -5`（若有现有 node:test）
Expected: 现有测试仍过(parseFlags/normalizeUrl 等导出未动)。

- [ ] **Step 4: Commit**
```bash
git add packages/browserctl/src/index.js packages/browserctl/package.json
git commit -m "refactor(browserctl): export run(argv, baseUrl?) + exports 字段 + bridgeUrl 用可变 activeBaseUrl(供壳包复用)"
```

---

### Task 1.2: browserctl-daemon 导出 `startDaemon(args)`

把 daemon 的 launch+attach+createBridge 序列从 `main()` 抽成可导出函数,供壳包 daemon-entry 复用。

**Files:**
- Modify: `packages/browserctl-daemon/src/index.ts`
- Modify: `packages/browserctl-daemon/package.json`（加 `exports`——**必做**）

- [ ] **Step 1: 抽出 startDaemon**

把 `main()` 里 **launch/connect → ChromeCdpTransport.attach → new BrowserController → createBridge → 打日志 → 注册 shutdown** 这段抽成导出函数(保留 parseArgs 在 main 里或也导出):
```ts
export async function startDaemon(args: Args): Promise<void> {
  // 原 main() 内 if(args.cdp)/else launch...mkdir...清锁...launch → transport.attach
  //   → new BrowserController(transport) → const host = new StandaloneHost({})
  //   → createBridge(controller, host, { port: args.port }) → 日志
  //   → 注册 SIGINT/SIGTERM shutdown(detach + chrome.kill)
}
```
`main()` 改为:`const args = parseArgs(process.argv.slice(2)); await startDaemon(args)`。**导出 `startDaemon` 与 `parseArgs`**(壳包 daemon-entry 要 import 它们);`Args`/`defaultProfileDir`/`resolveExecutable` 保持。

- [ ] **Step 1b: 给 browserctl-daemon/package.json 加 exports(必做)**

当前只有 `bin`、无 `exports`。壳包 `import { parseArgs, startDaemon } from "@workspace/browserctl-daemon"` 靠它解析:
```json
"exports": { ".": "./src/index.ts" }
```
(指 `.ts` 源,与 `browser-sdk` 同模式——壳包用 tsup 内联编译它。)

- [ ] **Step 2: typecheck + 既有测试**

Run: `cd packages/browserctl-daemon && npx tsc --noEmit && npx tsx --test test/chrome-transport.test.ts test/standalone-host.test.ts 2>&1 | grep -E "# (pass|fail)"`
Expected: typecheck clean;单测 5 pass(integration 需 Chrome,可单独)。

- [ ] **Step 3: Commit**
```bash
git add packages/browserctl-daemon/src/index.ts packages/browserctl-daemon/package.json
git commit -m "refactor(browserctl-daemon): 导出 startDaemon/parseArgs + exports 字段(供壳包 daemon-entry 复用)"
```

---

## Phase 2 — browserctl-cli 包骨架 + tsup build

### Task 2.1: 包骨架 + tsup 配置 + 依赖

**Files:**
- Create: `packages/browserctl-cli/package.json`
- Create: `packages/browserctl-cli/tsconfig.json`
- Create: `packages/browserctl-cli/tsup.config.ts`
- Create: `packages/browserctl-cli/src/cli.ts`（占位）
- Create: `packages/browserctl-cli/src/daemon-entry.ts`（占位）

- [ ] **Step 1: package.json**
```json
{
  "name": "browserctl-cli",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": { "browserctl": "dist/cli.js" },
  "files": ["dist", "bin"],
  "scripts": {
    "build": "tsup",
    "typecheck": "tsc --noEmit",
    "test": "node --import tsx --test test/*.test.ts"
  },
  "dependencies": {
    "chrome-launcher": "^1.1.0",
    "chrome-remote-interface": "^0.33.0"
  },
  "devDependencies": {
    "@workspace/browser-sdk": "workspace:*",
    "@workspace/browserctl-daemon": "workspace:*",
    "@workspace/browserctl": "workspace:*",
    "tsup": "^8.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.8.0",
    "@types/node": "^25.1.0"
  }
}
```
(workspace 包列 devDependencies 因为它们被 tsup **内联**进 dist,不作为运行时依赖。chrome-launcher/cri 列 dependencies——external。版本对齐 daemon 包已用的。)

> 注意:`browserctl` / `browserctl-daemon` 的 `exports` 字段已在 Task 1.1 / 1.2 补好(壳包 import `run` / `startDaemon` 依赖它们),此处无需再处理。

- [ ] **Step 2: tsconfig.json**（复制 `packages/browserctl-daemon/tsconfig.json`:NodeNext/strict/ES2022/types:["node"]）。

- [ ] **Step 3: tsup.config.ts**
```ts
import { defineConfig } from "tsup"

export default defineConfig({
  entry: { cli: "src/cli.ts", daemon: "src/daemon-entry.ts" },
  format: ["esm"],
  target: "node20",
  // 内联所有 @workspace/* 包；chrome-launcher/cri/node 内建留外部
  noExternal: [/@workspace\//],
  external: ["chrome-launcher", "chrome-remote-interface"],
  banner: { js: "#!/usr/bin/env node" },
  clean: true,
})
```

- [ ] **Step 4: 占位入口**
`src/cli.ts`:`export {}`;`src/daemon-entry.ts`:`export {}`。

- [ ] **Step 5: 安装**
Run: `pnpm install`
Expected: 新包入 workspace,tsup 装上。

- [ ] **Step 6: Commit**
```bash
git add packages/browserctl-cli/package.json packages/browserctl-cli/tsconfig.json packages/browserctl-cli/tsup.config.ts packages/browserctl-cli/src/cli.ts packages/browserctl-cli/src/daemon-entry.ts pnpm-lock.yaml
git commit -m "feat(browserctl-cli): 包骨架 + tsup 配置 + 依赖"
```

---

### Task 2.2: daemon-entry + 首次 build 冒烟

**Files:**
- Modify: `packages/browserctl-cli/src/daemon-entry.ts`

- [ ] **Step 1: 实现 daemon-entry**
```ts
import { parseArgs, startDaemon } from "@workspace/browserctl-daemon"
// 复用 daemon 的 parseArgs + startDaemon；本入口即 dist/daemon.js（被 CLI spawn）
await startDaemon(parseArgs(process.argv.slice(2)))
```
（若 daemon 未导出 parseArgs,在 Task 1.2 补导出,或在此自解析 argv——优先复用导出。）

- [ ] **Step 2: build + 冒烟内联是否完整**
Run: `cd packages/browserctl-cli && pnpm build`
Expected: 产出 `dist/cli.js` + `dist/daemon.js`,无 bundle 报错。
Run: `cd packages/browserctl-cli && node dist/daemon.js --help 2>&1 | head -5`
Expected: 不报 "Cannot find module"(证明 sdk/daemon 已内联);可能因无 --help 分支而 launch(那就 Ctrl+C/超时,只要不是模块缺失即可)。**若报模块缺失 → tsup noExternal/external 配置要调,记 DONE_WITH_CONCERNS**。

- [ ] **Step 3: Commit**
```bash
git add packages/browserctl-cli/src/daemon-entry.ts
git commit -m "feat(browserctl-cli): daemon-entry 复用 startDaemon + 首次 build 冒烟"
```

---

### Task 2.3: cli.ts 命令直通(暂不接 auto-start)+ build

先让 cli.ts 复用 `run`、能 `--version`/`health`,auto-start 留 Phase 3。

**Files:**
- Modify: `packages/browserctl-cli/src/cli.ts`

- [ ] **Step 1: 实现 cli.ts(直通版)**
```ts
import { run } from "@workspace/browserctl"
// 暂直通：baseUrl 用默认(env BROWSER_RUNTIME_BRIDGE_URL 或 34555)。Phase 3 接 ensureDaemon。
await run(process.argv.slice(2))
```

- [ ] **Step 2: build + 冒烟**
Run: `cd packages/browserctl-cli && pnpm build && node dist/cli.js --version`
Expected: 打印 browserctl 版本号(证明 run 内联可用)。

- [ ] **Step 3: Commit**
```bash
git add packages/browserctl-cli/src/cli.ts
git commit -m "feat(browserctl-cli): cli.ts 复用 run(直通版,--version 可跑)"
```

---

## Phase 3 — auto-start daemon

### Task 3.1: daemon-manager(状态/ensureDaemon/quit)+ 单测

**Files:**
- Create: `packages/browserctl-cli/src/daemon-manager.ts`
- Create: `packages/browserctl-cli/test/daemon-manager.test.ts`

- [ ] **Step 1: 写失败测试(纯逻辑:状态读写 + stale 判定 + 端口)**

mock 掉真实 spawn/http,只测可单测的纯逻辑。把"可测纯函数"抽出来:`readState/writeState/stateFile`(用临时目录注入)、`isAlive(state)`(给定 ping 结果)。
```ts
import test from "node:test"
import assert from "node:assert/strict"
import os from "node:os"
import path from "node:path"
import fs from "node:fs"
import { readState, writeState } from "../src/daemon-manager.js"

test("writeState/readState 往返", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bctl-"))
  const f = path.join(dir, "daemon.json")
  writeState(f, { port: 34556, pid: 999, browser: "chrome", startedAt: 1 })
  assert.deepEqual(readState(f), { port: 34556, pid: 999, browser: "chrome", startedAt: 1 })
})

test("readState 文件不存在 → null", () => {
  assert.equal(readState(path.join(os.tmpdir(), "nope-bctl.json")), null)
})
```

- [ ] **Step 2: 跑失败** → **Step 3: 实现 daemon-manager.ts**
```ts
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import http from "node:http"
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"

export interface DaemonState { port: number; pid: number; browser: string; startedAt: number }

const STATE_DIR = path.join(os.homedir(), ".browserctl")
export const defaultStateFile = path.join(STATE_DIR, "daemon.json")

export function readState(file = defaultStateFile): DaemonState | null {
  try { return JSON.parse(fs.readFileSync(file, "utf8")) as DaemonState } catch { return null }
}
export function writeState(file = defaultStateFile, s: DaemonState): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(s))
}

function pingHealth(port: number, timeoutMs = 1000): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port, path: "/internal/browser/health", timeout: timeoutMs },
      (res) => { res.resume(); resolve(res.statusCode === 200) })
    req.on("error", () => resolve(false))
    req.on("timeout", () => { req.destroy(); resolve(false) })
  })
}

// 确保 daemon 在跑，返回 baseUrl。无则 detached spawn dist/daemon.js 并等就绪。
export async function ensureDaemon(opts: { browser?: string } = {}): Promise<string> {
  const state = readState()
  if (state && (await pingHealth(state.port))) return `http://127.0.0.1:${state.port}`
  const port = 34555 // TODO: 占用则找空闲端口
  const daemonPath = fileURLToPath(new URL("./daemon.js", import.meta.url)) // 与 cli.js 同目录
  const child = spawn(process.execPath, [daemonPath, "--browser", opts.browser ?? "chrome", "--port", String(port)],
    { detached: true, stdio: "ignore" })
  child.unref()
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    if (await pingHealth(port)) {
      writeState(defaultStateFile, { port, pid: child.pid ?? 0, browser: opts.browser ?? "chrome", startedAt: Date.now() })
      return `http://127.0.0.1:${port}`
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error("daemon 启动超时(15s)：检查 Chrome 是否可用，或用 `browserctl serve` 前台启动看日志")
}

export function quitDaemon(): void {
  const state = readState()
  if (state?.pid) { try { process.kill(state.pid) } catch { /* already dead */ } }
  try { fs.rmSync(defaultStateFile, { force: true }) } catch { /* ignore */ }
}
```

- [ ] **Step 4: 跑测试 + typecheck**
Run: `cd packages/browserctl-cli && npx tsx --test test/daemon-manager.test.ts && npx tsc --noEmit`
Expected: 2 pass;typecheck clean。

- [ ] **Step 5: Commit**
```bash
git add packages/browserctl-cli/src/daemon-manager.ts packages/browserctl-cli/test/daemon-manager.test.ts
git commit -m "feat(browserctl-cli): daemon-manager(状态/ensureDaemon detached spawn/quit)+ 单测"
```

---

### Task 3.2: cli.ts 接 auto-start + serve/quit 命令

**Files:**
- Modify: `packages/browserctl-cli/src/cli.ts`

- [ ] **Step 1: 实现完整 cli.ts**
```ts
import { run } from "@workspace/browserctl"
import { parseArgs, startDaemon } from "@workspace/browserctl-daemon"
import { ensureDaemon, quitDaemon } from "./daemon-manager.js"

const argv = process.argv.slice(2)
const cmd = argv[0]

if (cmd === "serve") {
  // 显式前台 daemon（调试/换非默认配置），Ctrl+C 停
  await startDaemon(parseArgs(argv.slice(1)))
} else if (cmd === "quit") {
  quitDaemon()
  process.stdout.write(JSON.stringify({ ok: true, data: { quit: true } }) + "\n")
} else if (cmd === "--version" || cmd === "--help" || !cmd) {
  await run(argv) // 不需要 daemon
} else {
  // 浏览器命令：auto-start daemon → 用其 baseUrl 跑命令
  const baseUrl = await ensureDaemon()
  await run(argv, baseUrl)
}
```

- [ ] **Step 2: build + typecheck**
Run: `cd packages/browserctl-cli && pnpm build && npx tsc --noEmit && node dist/cli.js --version`
Expected: build ok;typecheck clean;--version 打印。

- [ ] **Step 3: Commit**
```bash
git add packages/browserctl-cli/src/cli.ts
git commit -m "feat(browserctl-cli): cli 接 auto-start(ensureDaemon)+ serve/quit 命令"
```

---

## Phase 4 — 本地全局 + 端到端冒烟

### Task 4.1: bin wrapper + README

**Files:**
- Create: `packages/browserctl-cli/bin/browserctl.cmd`
- Create: `packages/browserctl-cli/bin/browserctl`
- Create: `packages/browserctl-cli/README.md`

- [ ] **Step 1: wrapper**（参照 `packages/browserctl/bin/browserctl.cmd` 现有写法）
`bin/browserctl.cmd`:
```bat
@echo off
node "%~dp0..\dist\cli.js" %*
```
`bin/browserctl`(*nix, 可执行):
```bash
#!/usr/bin/env bash
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$DIR/../dist/cli.js" "$@"
```

- [ ] **Step 2: README**：装/用说明——`pnpm --filter browserctl-cli build` → 把 `packages\browserctl-cli\bin` 加 PATH(或 `pnpm --filter browserctl-cli link --global`)→ `browserctl open <url>`;`browserctl serve/quit`;默认 chrome 有头持久 profile;npm publish 暂缓。**Windows 注意**:`quit` 会清状态文件,但 `process.kill` 在 Windows 上未必可靠停掉 daemon 进程;残留时用 `taskkill /PID <pid> /F`(pid 见 `~/.browserctl/daemon.json`)。Chrome 的关闭由 daemon 收到信号后的 shutdown handler 间接完成。

- [ ] **Step 3: Commit**
```bash
git add packages/browserctl-cli/bin/browserctl.cmd packages/browserctl-cli/bin/browserctl packages/browserctl-cli/README.md
git commit -m "feat(browserctl-cli): bin wrapper(PATH 全局)+ README"
```

---

### Task 4.2: 端到端冒烟(手动验收)

> 需 Chrome 可用。本任务人工跑,不由子代理自动执行。

- [ ] **Step 1: build + 全局**:`pnpm --filter browserctl-cli build`,把 `packages\browserctl-cli\bin` 加 PATH(或 `pnpm --filter browserctl-cli link --global`)。
- [ ] **Step 2: auto-start**:新终端任意目录 `browserctl open https://www.baidu.com` → 应自动拉起 daemon + Chrome,返回 `ok:true`。
- [ ] **Step 3: 复用**:`browserctl snapshot --interactive` → 拿到 @eN(第二条命令秒回,证明 daemon 复用)。
- [ ] **Step 4: 生命周期**:`browserctl quit` → daemon 停、Chrome 关、状态文件删。
- [ ] **Step 5: serve**:`browserctl serve --browser edge --headless`(可选)前台起,另终端跑命令,Ctrl+C 停。

---

## 收尾

Phase 1–3 子代理完成 + 各自 review;Phase 4 人工冒烟。全绿后:
1. 内部包回归:`cd packages/browser-sdk && npx tsx --test test/*.test.ts`(13)、`cd packages/browserctl-daemon && npx tsx --test test/*.test.ts`(6)仍绿。
2. 走 superpowers:finishing-a-development-branch 合并回 dev。
3. **后续(暂缓)**:npm publish(去 private + publishConfig + LICENSE);多会话 `--session`。
   - ✅ **已落地**:ensureDaemon 空闲端口自动选(`pickFreePort`,不再硬编码 34555)+ daemon 启动失败可观测(stderr 落盘 `~/.browserctl/daemon.log`,子进程早退立即读日志尾部抛真实原因,不再干等 15s)+ 复用前 `isPidAlive` 校验。见 `feat/browserctl-cli-free-port` 分支。
