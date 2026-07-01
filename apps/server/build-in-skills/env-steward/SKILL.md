---
name: env-steward
description: Use when user reports `command not found` errors for python/node/git/curl, version incompatibility, or "missing Python dependency" / "Node.js required" in skill output.
---

# 环境管家

## Overview

跨平台（Windows / macOS / Linux）检测与安装 **Python、Node.js、Git、curl** 四类基础开发环境。只负责检测 + 安装，不涉及 IDE 配置、pip/npm 镜像、虚拟环境等。

## When to Use

Symptoms:
- 用户说"装个 Python / Node / git"
- skill 输出里出现 `command not found`、`not recognized`、`module not found`
- 用户报"版本太低""版本不兼容"（如 Python 3.8 需要的包装不上）
- 扩展启动失败日志里提示 node/git 缺失

When NOT to use:
- 用户问 IDE 配置、pip/npm 镜像、.npmrc 等——告知不在范围内
- 需要 venv/conda 虚拟环境管理——告知不在范围内

## Quick Reference

| Task | Command Pattern | Platform |
|------|----------------|----------|
| Detect tool | `<tool> --version` 或 `which <tool>` | All |
| Platform info | `uname -s && uname -m` (macOS/Linux) / `ver` (Win) | All |
| Install Python | `winget` / `brew` / `apt` / `dnf` | Per-platform |
| Install Node.js | `winget` / `brew` / `apt` / `dnf` | Per-platform |
| Install Git | `winget` / `brew` / `xcode-select` / `apt` | Per-platform |
| Install curl | Win 10+ / macOS built-in; `winget` / `apt` | Per-platform |
| Offline check | `ls ~/.digital-employee/.offline` / `if exist` | All |

## Implementation

### Step 0: Offline mode check

Run `ls -la ~/.digital-employee/.offline 2>/dev/null` (macOS/Linux) or `if exist "%USERPROFILE%\.digital-employee\.offline" echo OFFLINE` (Win).

If `.offline` exists → **only detect, never install**. Tell user explicitly.

### Step 1: Platform detection

```
macOS/Linux: uname -s && uname -m
Windows:     ver
```

Keep result in context; branch commands accordingly.

### Step 2: Detect target tools

```
<tool> --version   # e.g. python --version, node --version
which <tool>       # find PATH location, e.g. which python3
```

Present table to user:

| Tool | Installed | Version | Path | Status |
|------|-----------|---------|------|--------|
| Python | ✅ / ❌ | 3.12.2 | /usr/bin/python3 | OK / Upgrade needed |
| Node.js | ... | ... | ... | ... |

### Step 3: Clarify intent (must use submit_clarifying_questions)

If user wants install/upgrade, ask:
- "Which version?" (Python: 3.11/3.12; Node: 20/22 LTS)
- "System-level install (needs admin/sudo)?"
- "If Homebrew/sudo unavailable, accept manual download link?"

### Step 4: Submit plan (must use submit_document_plan)

List every command, expected output, estimated time, rollback plan.

### Step 5: Execute (each command through shell_execute HITL)

**Detection commands** (`--version`, `which`): run directly — they complete under 1s, well within 30s timeout.

**Install/upgrade commands** (`winget install`, `brew install`, `apt install`): these exceed 30s timeout. Use one of:

Option A (recommended) — background + poll:
```bash
winget install Python.Python.3.12 > /tmp/install.log 2>&1 &
echo $! > /tmp/install.pid

while kill -0 $(cat /tmp/install.pid) 2>/dev/null; do
  sleep 2; echo "still installing... ($(date +%T))"
done
echo "=== done ==="
tail -20 /tmp/install.log
```

Option B — launch detached, tell user to check manually:
```powershell
# Windows
Start-Process winget -ArgumentList "install","Python.Python.3.12" -NoNewWindow
```
```bash
# macOS/Linux
nohup brew install python@3.12 > ~/.digital-employee/logs/install-python.log 2>&1 &
```

Set `intent` field on every shell_execute call (e.g. `"安装 Python 3.12"`).

### Step 6: Verify

Re-run `--version`, confirm new version, report to user.

## Platform Command Reference

### Python

| Platform | Command |
|----------|---------|
| Windows | `winget install Python.Python.3.12` |
| Windows fallback | `choco install python3` |
| macOS (brew) | `brew install python@3.12` |
| macOS no brew | guide user to install Homebrew first |
| Debian/Ubuntu | `sudo apt update && sudo apt install -y python3.12` |
| RHEL/Fedora | `sudo dnf install -y python3.12` |
| Arch | `sudo pacman -S python` |
| Manual fallback | python.org/downloads |

### Node.js

| Platform | Command |
|----------|---------|
| Windows | `winget install OpenJS.NodeJS.LTS` |
| macOS | `brew install node@20` |
| Debian/Ubuntu | `curl -fsSL https://deb.nodesource.com/setup_20.x \| sudo -E bash - && sudo apt install -y nodejs` |
| RHEL/Fedora | `sudo dnf install -y nodejs` |
| Arch | `sudo pacman -S nodejs npm` |
| Manual fallback | nodejs.org |

### Git

| Platform | Command |
|----------|---------|
| Windows | `winget install Git.Git` |
| macOS (default) | often pre-installed; else `xcode-select --install` or `brew install git` |
| Debian/Ubuntu | `sudo apt install -y git` |
| RHEL/Fedora | `sudo dnf install -y git` |
| Arch | `sudo pacman -S git` |
| Manual fallback | git-scm.com |

### curl

| Platform | Command |
|----------|---------|
| Windows 10+ | built-in |
| Windows <10 | `winget install cURL.cURL` |
| macOS | built-in |
| Debian/Ubuntu | `sudo apt install -y curl` |
| RHEL/Fedora | `sudo dnf install -y curl` |
| Arch | `sudo pacman -S curl` |

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Running `winget install` + polling with shell_execute kills the process at 30s | Use Option A background+poll or Option B detached launch |
| Skips offline check, tries install in OFFLINE_MODE | Step 0 must run before any install |
| Installs without asking version/consent | Step 3: always use `submit_clarifying_questions` |
| Runs `sudo apt` without user confirmation | Step 3: confirm admin intent; Step 4: document plan |
| Uses wrong package name for distro (Ubuntu vs Fedora) | Check platform first, then use matching row in command reference |
| Tells user "everything is fine" without checking both `python` and `python3` | Run both `which python` and `which python3` — they can differ |
| Installing multiple tools in one plan | Install one at a time; 1 tool per plan |

## Security Principles

1. Never run `sudo` / "Run as Administrator" without explicit user consent via `submit_clarifying_questions`
2. Every install/upgrade command must pass `submit_document_plan` first
3. Capture stderr, report non-zero exit codes to user
4. One tool per plan — no combined installs
5. Install failures must show manual download link (python.org, nodejs.org, git-scm.com)
6. Commands exceeding 30s **must** use Option A or Option B — direct `winget install` will timeout and appear to fail

## Known Limitations

- shell_execute default 30s timeout applies; install commands (winget, brew) take 60-300s and require the poll/detach pattern
- Linux distro fragmentation: only Debian/Ubuntu, RHEL/Fedora, Arch are listed. Unrecognized distros go to manual-link fallback
- Does not configure pip/npm mirrors, .npmrc, or IDE settings
- Does not create/manage Python venv or Node nvm
