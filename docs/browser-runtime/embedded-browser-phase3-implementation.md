# 阶段 3：Session 隔离 + 审计 + 安全 — 实施文档

> 预计工期：1 周 | 依赖：阶段 2 完成 | 状态：待开始

## 目标

多 conversation 隔离 Cookie；全量审计日志；URL 白名单留口（默认全开）；设置页可视化。

---

## 实施步骤

### Step 3.1 — BrowserSessionStore（Electron 主进程）

**新建文件：** `apps/web/electron/features/browser/browser-session-store.ts`

职责：管理 `session_id → partition` 映射，每个 conversation 独立 partition。

```typescript
import { session } from "electron"

export class BrowserSessionStore {
  private sessions = new Map<string, string>() // sessionId → partition name

  getPartition(sessionId: string): string {
    if (!this.sessions.has(sessionId)) {
      const partition = `persist:browser-panel-${sessionId}`
      this.sessions.set(sessionId, partition)
    }
    return this.sessions.get(sessionId)!
  }

  getSession(sessionId: string) {
    const partition = this.getPartition(sessionId)
    return session.fromPartition(partition)
  }

  clearSession(sessionId: string): Promise<void> {
    const ses = this.getSession(sessionId)
    this.sessions.delete(sessionId)
    return ses.clearStorageData()
  }

  listSessions(): string[] {
    return Array.from(this.sessions.keys())
  }
}
```

### Step 3.2 — URL 白名单

**新建文件：** `apps/web/electron/features/browser/url-allowlist.ts`

```typescript
import * as fs from "fs"
import * as path from "path"
import { app } from "electron"

interface AllowlistConfig {
  allow: string[]
  deny: string[]
  ask_each_time: boolean
  audit: boolean
}

const DEFAULT_CONFIG: AllowlistConfig = {
  allow: ["*"],
  deny: [],
  ask_each_time: false,
  audit: true,
}

function getConfigPath(): string {
  const configDir = path.join(app.getPath("home"), ".digital-employee", "configs")
  fs.mkdirSync(configDir, { recursive: true })
  return path.join(configDir, "browser-allowlist.json")
}

export class UrlAllowlist {
  private config: AllowlistConfig

  constructor() {
    this.config = this.load()
  }

  private load(): AllowlistConfig {
    const configPath = getConfigPath()
    try {
      if (fs.existsSync(configPath)) {
        const raw = fs.readFileSync(configPath, "utf-8")
        return { ...DEFAULT_CONFIG, ...JSON.parse(raw) }
      }
    } catch {}
    this.save(DEFAULT_CONFIG)
    return DEFAULT_CONFIG
  }

  private save(config: AllowlistConfig) {
    fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2), "utf-8")
  }

  isAllowed(url: string): { allowed: boolean; reason?: string } {
    try {
      const hostname = new URL(url).hostname

      // 先检查 deny
      for (const pattern of this.config.deny) {
        if (this.matchPattern(hostname, pattern)) {
          return { allowed: false, reason: `域名 ${hostname} 在黑名单中 (${pattern})` }
        }
      }

      // 再检查 allow
      for (const pattern of this.config.allow) {
        if (pattern === "*" || this.matchPattern(hostname, pattern)) {
          return { allowed: true }
        }
      }

      return { allowed: false, reason: `域名 ${hostname} 不在白名单中` }
    } catch {
      return { allowed: false, reason: "无效 URL" }
    }
  }

  private matchPattern(hostname: string, pattern: string): boolean {
    if (pattern.startsWith("*.")) {
      return hostname.endsWith(pattern.slice(1)) || hostname === pattern.slice(2)
    }
    return hostname === pattern
  }

  isAuditEnabled(): boolean {
    return this.config.audit
  }

  getConfig(): AllowlistConfig {
    return { ...this.config }
  }

  updateConfig(updates: Partial<AllowlistConfig>) {
    this.config = { ...this.config, ...updates }
    this.save(this.config)
  }
}
```

### Step 3.3 — 审计日志（Electron 主进程）

**新建文件：** `apps/web/electron/features/browser/audit-log.ts`

```typescript
import * as fs from "fs"
import * as path from "path"
import { app } from "electron"

export interface AuditEntry {
  id: number
  ts: number
  conversation_id: string
  employee_id?: string
  action: string
  ref?: string
  url?: string
  intent?: string
  blocked: boolean
  screenshot_path?: string
  error?: string
}

export class AuditLog {
  private logPath: string
  private entries: AuditEntry[] = []
  private nextId = 1

  constructor() {
    const logDir = path.join(app.getPath("home"), ".digital-employee", "logs")
    fs.mkdirSync(logDir, { recursive: true })
    this.logPath = path.join(logDir, "browser-audit.json")
    this.load()
  }

  private load() {
    try {
      if (fs.existsSync(this.logPath)) {
        const raw = fs.readFileSync(this.logPath, "utf-8")
        this.entries = JSON.parse(raw)
        this.nextId = this.entries.length > 0
          ? Math.max(...this.entries.map((e) => e.id)) + 1
          : 1
      }
    } catch {}
  }

  private persist() {
    fs.writeFileSync(this.logPath, JSON.stringify(this.entries, null, 2), "utf-8")
  }

  append(entry: Omit<AuditEntry, "id" | "ts">) {
    const full: AuditEntry = {
      ...entry,
      id: this.nextId++,
      ts: Date.now(),
    }
    this.entries.push(full)
    this.persist()
    return full
  }

  getRecent(limit = 100): AuditEntry[] {
    return this.entries.slice(-limit)
  }

  getByConversation(conversationId: string, limit = 100): AuditEntry[] {
    return this.entries
      .filter((e) => e.conversation_id === conversationId)
      .slice(-limit)
  }

  exportAll(): AuditEntry[] {
    return [...this.entries]
  }

  clear() {
    this.entries = []
    this.nextId = 1
    this.persist()
  }
}
```

### Step 3.4 — Python 后端审计表

**新建文件：** `apps/server/src/service/browser/audit_log.py`

```python
"""Browser audit log — SQLite-backed for server-side queries."""
from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence


@dataclass
class BrowserAuditEntry:
    id: int
    ts: int
    conversation_id: str
    employee_id: str | None = None
    action: str = ""
    ref: str | None = None
    url: str | None = None
    intent: str | None = None
    blocked: bool = False
    screenshot_path: str | None = None
    error: str | None = None


_DDL = """
CREATE TABLE IF NOT EXISTS browser_audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    conversation_id TEXT NOT NULL,
    employee_id TEXT,
    action TEXT NOT NULL,
    ref TEXT,
    url TEXT,
    intent TEXT,
    blocked INTEGER DEFAULT 0,
    screenshot_path TEXT,
    error TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_conv_ts
    ON browser_audit_log(conversation_id, ts);
"""


class BrowserAuditLog:
    def __init__(self, db_path: str | Path):
        self._conn = sqlite3.connect(str(db_path))
        self._conn.row_factory = sqlite3.Row
        self._conn.executescript(_DDL)

    def insert(self, entry: dict) -> int:
        cols = [k for k in entry if k != "id"]
        vals = [entry[k] for k in cols]
        placeholders = ", ".join(["?"] * len(cols))
        col_names = ", ".join(cols)
        cur = self._conn.execute(
            f"INSERT INTO browser_audit_log ({col_names}) VALUES ({placeholders})",
            vals,
        )
        self._conn.commit()
        return cur.lastrowid

    def get_recent(self, limit: int = 100) -> Sequence[dict]:
        rows = self._conn.execute(
            "SELECT * FROM browser_audit_log ORDER BY ts DESC LIMIT ?",
            (limit,),
        ).fetchall()
        return [dict(r) for r in rows]

    def get_by_conversation(self, conversation_id: str, limit: int = 100) -> Sequence[dict]:
        rows = self._conn.execute(
            "SELECT * FROM browser_audit_log WHERE conversation_id = ? ORDER BY ts DESC LIMIT ?",
            (conversation_id, limit),
        ).fetchall()
        return [dict(r) for r in rows]

    def export_json(self) -> str:
        rows = self._conn.execute(
            "SELECT * FROM browser_audit_log ORDER BY ts"
        ).fetchall()
        return json.dumps([dict(r) for r in rows], ensure_ascii=False, indent=2)

    def clear(self) -> None:
        self._conn.execute("DELETE FROM browser_audit_log")
        self._conn.commit()

    def close(self) -> None:
        self._conn.close()
```

### Step 3.5 — 设置页组件

**新建文件：** `apps/web/src/components/settings/browser-settings-section.tsx`

```tsx
import * as React from "react"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"

interface AuditEntry {
  id: number
  ts: number
  action: string
  url?: string
  ref?: string
  blocked: boolean
}

export function BrowserSettingsSection() {
  const [auditLog, setAuditLog] = React.useState<AuditEntry[]>([])
  const [loading, setLoading] = React.useState(false)

  const fetchAuditLog = React.useCallback(async () => {
    setLoading(true)
    try {
      const resp = await fetch("/api/browser/audit?limit=100")
      const data = await resp.json()
      setAuditLog(data.entries || [])
    } catch {
      setAuditLog([])
    } finally {
      setLoading(false)
    }
  }, [])

  const handleClearAudit = React.useCallback(async () => {
    await fetch("/api/browser/audit", { method: "DELETE" })
    setAuditLog([])
  }, [])

  const handleExportDiagnostic = React.useCallback(async () => {
    const resp = await fetch("/api/browser/audit/export")
    const blob = await resp.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "browser-audit-log.json"
    a.click()
    URL.revokeObjectURL(url)
  }, [])

  return (
    <Card>
      <CardHeader>
        <CardTitle>浏览器</CardTitle>
        <CardDescription>管理内嵌浏览器的审计日志与安全设置</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={fetchAuditLog} disabled={loading}>
            刷新审计日志
          </Button>
          <Button variant="outline" size="sm" onClick={handleClearAudit}>
            清空日志
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportDiagnostic}>
            导出诊断数据
          </Button>
        </div>

        <div className="max-h-96 overflow-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-3 py-2 text-left">时间</th>
                <th className="px-3 py-2 text-left">操作</th>
                <th className="px-3 py-2 text-left">URL</th>
                <th className="px-3 py-2 text-left">状态</th>
              </tr>
            </thead>
            <tbody>
              {auditLog.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 py-4 text-center text-muted-foreground">
                    暂无审计记录
                  </td>
                </tr>
              ) : (
                auditLog.map((entry) => (
                  <tr key={entry.id} className="border-t">
                    <td className="px-3 py-1.5">
                      {new Date(entry.ts).toLocaleString()}
                    </td>
                    <td className="px-3 py-1.5">{entry.action}</td>
                    <td className="max-w-48 truncate px-3 py-1.5">{entry.url || "—"}</td>
                    <td className="px-3 py-1.5">
                      {entry.blocked ? (
                        <span className="text-destructive">已拦截</span>
                      ) : (
                        <span className="text-muted-foreground">正常</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}
```

### Step 3.6 — 修改 BrowserWindowController 支持 session

**修改文件：** `apps/web/electron/features/browser/browser-window-controller.ts`

```typescript
// open() 方法接受 sessionId 参数
open(url: string, bounds: Rectangle, sessionId: string = "default") {
  // ...
  const partition = `persist:browser-panel-${sessionId}`
  const ses = session.fromPartition(partition)
  // ... 创建 BrowserWindow 时使用 ses
}
```

### Step 3.7 — 修改 IPC 支持 session 路由

**修改文件：** `apps/web/electron/shared/ipc-channels.ts`

```typescript
// browserOpen 的 args 增加可选 sessionId
[IpcChannels.browserOpen]: {
  args: [url: string, bounds: Rectangle, sessionId?: string]
  result: void
}
```

### Step 3.8 — 审计 API 路由

**修改文件：** `apps/server/src/service/browser/http_routes.py`

添加审计相关路由：

```python
@router.get("/audit")
async def get_audit_log(limit: int = 100):
    # 返回最近 N 条审计记录
    ...

@router.delete("/audit")
async def clear_audit_log():
    # 清空审计日志
    ...

@router.get("/audit/export")
async def export_audit_log():
    # 导出审计日志 JSON
    ...
```

---

## 新增/修改文件清单

### 新增 5 个

| # | 路径 | 职责 |
|---|------|------|
| 1 | `apps/web/electron/features/browser/browser-session-store.ts` | session → partition 映射 |
| 2 | `apps/web/electron/features/browser/url-allowlist.ts` | 域名白名单 |
| 3 | `apps/web/electron/features/browser/audit-log.ts` | 操作审计（Electron 侧） |
| 4 | `apps/server/src/service/browser/audit_log.py` | 审计表（Python 侧） |
| 5 | `apps/web/src/components/settings/browser-settings-section.tsx` | 设置页 UI |

### 修改 4 个

| # | 路径 | 改动 |
|---|------|------|
| 1 | `apps/web/electron/features/browser/browser-window-controller.ts` | open() 支持 sessionId |
| 2 | `apps/web/electron/shared/ipc-channels.ts` | browserOpen 增加 sessionId |
| 3 | `apps/web/electron/features/browser/ipc.ts` | handler 使用 sessionStore |
| 4 | `apps/server/src/service/browser/http_routes.py` | 审计 API |

---

## 验收标准

- [ ] 两个 conversation 同时打开浏览器 → 互不污染 Cookie（DevTools 验证 partition 独立）
- [ ] 审计日志最近 100 条在设置页可视化
- [ ] 诊断 zip 导出包含 `browser_audit_log.json` + `browser-screenshots/`
- [ ] 运维修改 `allow: ["*.example.com"]` 后访问 `https://evil.com` → 拦截 + 写 audit
