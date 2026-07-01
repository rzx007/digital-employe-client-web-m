# browserctl-cli

Self-contained global CLI to drive a standalone Chrome/Edge via browserctl commands. Designed for non-Electron use: CI pipelines, local automation scripts, or any context where you want the full `browserctl` command set without the Electron shell.

The command set is identical to the Electron-embedded `browserctl`; the difference is the daemon runs as a plain Node.js process rather than inside Electron.

**Requirements:** Node.js ≥ 20, Google Chrome or Microsoft Edge installed.

---

## Install

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

## Usage

Quick start:

```bash
browserctl open https://www.baidu.com
browserctl snapshot --interactive
browserctl fill @e1 "search query"
browserctl click @e2
browserctl screenshot --annotate --out shot.png
browserctl quit
```

Full command reference (same as desktop `browserctl`, minus Electron-only `open-artifact` / `close`):

```bash
browserctl health
browserctl open <url>                 # = navigate
browserctl snapshot [--max-nodes 200] [--compact|-c] [--depth N|-d N] [--scope <sel>|-s <sel>] [--tree | --interactive]
browserctl wait (--selector <css> [--state visible|hidden] | --text <text> | --url <glob> | --load load|domcontentloaded|networkidle | --fn <js> | --fn-file <path> | --fn-stdin | --ms <n>) [--timeout 10000]
browserctl eval (<js> | --file <path> | --stdin) [--timeout 10000]
browserctl click <@eN|selector> [--confirm "确认文案"]
browserctl fill <@eN|selector> (<text> | --text-file <path> | --text-stdin)
browserctl hover|dblclick|focus|type|check|uncheck <@eN|selector>
browserctl drag <@eN|selector> <@eN|selector>
browserctl upload <@eN|selector> <file...>
browserctl press <key> [@eN|selector] [--ctrl|--shift|--alt|--meta]
browserctl scroll [@eN|selector] [--to top|bottom] [--by <px>]
browserctl select <@eN|selector> (<value> | --label <文本>)
browserctl get url|title|value|text|attr <@eN|selector> [attrName]
browserctl is visible|enabled|checked <@eN|selector>
browserctl find role|text|…  # positional；或 find <action> --role|--selector|… flag 模式
browserctl back|forward|reload
browserctl scrollintoview|scroll-into-view <@eN|selector>
browserctl dialog status|accept [text]|dismiss
browserctl extract-text
browserctl screenshot [--annotate] [--out <path>]
browserctl batch [--bail] [--json] "<cmd>" …
```

Detailed syntax, `find` flag mode, `dialog` semantics, and `batch` examples:
[command reference](./docs/reference.md).

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

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BROWSER_RUNTIME_BRIDGE_URL` | `http://127.0.0.1:34555` | Daemon bridge URL (auto-set by CLI) |
| `BROWSER_RUNTIME_TIMEOUT_MS` | `60000` | Per-request socket timeout |
| `BROWSERCTL_STATE_DIR` | `~/.browserctl` | Daemon PID/state directory |

---

## Windows note: process cleanup

`browserctl quit` writes a stop signal and cleans the state file, but `process.kill` may not reliably terminate the daemon process on Windows. If the daemon lingers after `quit`:

1. Find the PID in `~/.browserctl/daemon.json`.
2. Force-kill it:

   ```cmd
   taskkill /PID <pid> /F
   ```

Chrome is closed indirectly by the daemon's shutdown handler; if Chrome also lingers, close it manually.
