# browserctl-cli

Self-contained global CLI to drive a standalone Chrome/Edge via browserctl commands. Designed for non-Electron use: CI pipelines, local automation scripts, or any context where you want the full `browserctl` command set without the Electron shell.

The command set is identical to the Electron-embedded `browserctl`; the difference is the daemon runs as a plain Node.js process rather than inside Electron.

**Requirements:** Node.js ≥ 20, Google Chrome or Microsoft Edge installed.

---

## Install (npm)

```bash
npm install -g browserctl-cli
# or
pnpm add -g browserctl-cli
```

Then:

```bash
browserctl open https://www.baidu.com
browserctl snapshot --interactive
browserctl quit
```

Global install registers the `browserctl` command (auto-starts a background daemon on first use).

---

## Build

```bash
pnpm --filter browserctl-cli build
```

Produces:
- `dist/cli.js` — the CLI entry (handles all subcommands)
- `dist/daemon.js` — the background daemon entry (auto-started by the CLI)

---

## Global use

### Option 1 — Add `bin` directory to PATH (no install step)

**Windows** — add to your user `PATH` in System Settings:
```
packages\browserctl-cli\bin
```

**macOS / Linux** — add to your shell profile (`~/.bashrc`, `~/.zshrc`):
```bash
export PATH="/path/to/packages/browserctl-cli/bin:$PATH"
```

Then open a new terminal and run `browserctl --help`.

> Note: on Windows the `bin/browserctl` POSIX wrapper is unused; `bin/browserctl.cmd` is picked up automatically by `cmd.exe` / PowerShell.

### Option 2 — pnpm global link

```bash
pnpm --filter browserctl-cli link --global
```

After linking, `browserctl` is available system-wide via pnpm's global bin directory (no PATH editing needed).

---

## Usage

```bash
# Open a URL (auto-starts daemon + Chrome on first command)
browserctl open https://www.baidu.com

# Take a full-page snapshot and enter interactive element-picker mode
browserctl snapshot --interactive

# Compact snapshot with depth limit and scoped subtree
browserctl snapshot -c -d 3 -s "#main"

# Fill an input identified by element number
browserctl fill @eN "search query"

# Click an element identified by element number
browserctl click @eN

# Hover / double-click / focus an element
browserctl hover @eN
browserctl dblclick @eN
browserctl focus @eN

# Type (append, does not clear) into an input identified by element number
browserctl type @eN "search query"

# Check / uncheck a checkbox or radio
browserctl check @eN
browserctl uncheck @eN

# Drag from one element to another
browserctl drag @eN @eM

# Upload files to an <input type="file">
browserctl upload @eN file1.png file2.pdf

# Wait for page conditions (selector, URL glob, network idle, JS expression)
browserctl wait --selector "#result"
browserctl wait --url "https://example.com/dashboard"
browserctl wait --load networkidle
browserctl wait --load load
browserctl wait --load domcontentloaded
browserctl wait --fn "document.querySelector('.ready') !== null"

# Run JavaScript in the page context
browserctl eval "document.title"
browserctl eval --file ./script.js [--timeout 15000]

# Get the current page URL
browserctl get url

# Read element text or state
browserctl get text @eN
browserctl is visible @eN
browserctl is enabled @eN
browserctl is checked @eN
browserctl find role button click --name "Submit"
browserctl find first "#kw" fill "keywords"

# Save a screenshot to a file
browserctl screenshot --out shot.png

# Annotated screenshot with @eN labels (for HITL / vision models)
browserctl snapshot --interactive
browserctl screenshot --annotate --out shot-annotated.png
```

---

## Daemon lifecycle

The daemon process manages the browser session in the background.

**Auto-start** — the first browser command automatically starts the daemon (default: Chrome, headed, persistent profile at `~/.browserctl/profile-chrome`). No explicit step needed.

**Chrome window closed** — if you close the browser window, the daemon exits automatically; the next `browserctl` command starts a fresh daemon and Chrome (login state is kept in the persistent profile). You do not need `browserctl quit` in this case.

**Explicit start with non-default config** — runs in the foreground; press `Ctrl+C` to stop:
```bash
browserctl serve --browser edge --headless
```

**Stop** — shuts down the daemon and closes the browser:
```bash
browserctl quit
```

---

## Login state (OA / SSO)

Use the persistent profile to avoid repeated logins:

1. Run any command (e.g. `browserctl open https://your-oa/`) — Chrome opens with the persistent profile.
2. Log in manually in the browser window that appears.
3. Close the window or leave it open — the profile is preserved across restarts.

Subsequent daemon starts reuse the same profile, so login state is retained automatically.

---

## Windows note: process cleanup

`browserctl quit` writes a stop signal and cleans the state file, but `process.kill` may not reliably terminate the daemon process on Windows. If the daemon lingers after `quit`:

1. Find the PID in `~/.browserctl/daemon.json`.
2. Force-kill it:
   ```cmd
   taskkill /PID <pid> /F
   ```

Chrome is closed indirectly by the daemon's shutdown handler; if Chrome also lingers, close it manually.

---

## npm publish

Maintainers（需先 `npm login`）：

```bash
# 推荐：自动 bump 版本 + 测试 + 发布（auto = npm 已有同版本则 patch+1）
pnpm publish:browserctl-cli

# 或在包目录指定 bump 级别
pnpm --filter browserctl-cli release:patch
pnpm --filter browserctl-cli release:minor
pnpm --filter browserctl-cli release:major
```

| 命令 | 版本规则 |
|------|----------|
| `release` / `publish:browserctl-cli` | **auto**：npm 无包→用当前版本；npm 已有且 ≥ 本地→在 npm 最新上 patch+1 |
| `release:patch` | 本地版本 patch+1 |
| `release:minor` | 本地版本 minor+1 |
| `release:major` | 本地版本 major+1 |

发布后请 **commit** `packages/browserctl-cli/package.json` 的版本号变更。

`prepublishOnly` 会在 publish 前自动 `tsup build`。Dry-run：`pnpm --filter browserctl-cli pack`
