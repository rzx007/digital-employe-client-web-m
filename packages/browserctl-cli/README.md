# browserctl-cli

Self-contained global CLI to drive a standalone Chrome/Edge via browserctl commands. Designed for non-Electron use: CI pipelines, local automation scripts, or any context where you want the full `browserctl` command set without the Electron shell.

The command set is identical to the Electron-embedded `browserctl`; the difference is the daemon runs as a plain Node.js process rather than inside Electron.

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

# Fill an input identified by element number
browserctl fill @eN "search query"

# Click an element identified by element number
browserctl click @eN

# Get the current page URL
browserctl get url

# Save a screenshot to a file
browserctl screenshot --out shot.png
```

---

## Daemon lifecycle

The daemon process manages the browser session in the background.

**Auto-start** — the first browser command automatically starts the daemon (default: Chrome, headed, persistent profile at `~/.browserctl/profile-chrome`). No explicit step needed.

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

Deferred — the package is `"private": true` for now.
