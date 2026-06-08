# Agent 自然语言打开产物 HTML（browserctl open-artifact）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development。Steps 用 `- [ ]` 跟踪。

**Goal:** 让 Agent 用一条命令 `browserctl open-artifact <虚拟路径>` 把会话产物目录里的 HTML 在内嵌 browser-panel 打开（自动识别会话、支持相对资源、browserctl 可交互），不依赖 FileChangeCard。

**Architecture:** 复用上一个功能的后端静态端点 + browser-panel + navigate 自动展开右栏。新增三处接线：① browserctl 新命令 `open-artifact`，读 `CONVERSATION_ID` + `BROWSER_RUNTIME_BACKEND_URL` 两个 env 拼后端 static URL 后走 navigate；② 后端 `SkillAwareShellBackend` 把 `CONVERSATION_ID` 注入 shell 子进程 env（per-conversation，新建实例隔离，不串台）；③ Electron 把 `BROWSER_RUNTIME_BACKEND_URL` 注入 browserctl env。外加 SKILL 文档教用法。

**Tech Stack:** Node CLI（browserctl, node:test）、FastAPI 后端（Python, pytest）、Electron 主进程（TS）。

---

## File Structure
- Modify `packages/browserctl/src/index.js`：新增 `open-artifact` 命令 + usage。
- Modify `packages/browserctl/test/index.test.js`：新增 open-artifact 用例。
- Modify `apps/server/src/service/skill_shell_backend.py`：`__init__` 加 `conversation_id` 参数 → 注入 `_env["CONVERSATION_ID"]`。
- Modify `apps/server/src/service/agent/employee.py` + `apps/server/src/service/agent/orchestrator/agent.py`：实例化 `SkillAwareShellBackend` 时传 `conversation_id`。
- Test `apps/server/tests/test_shell_conversation_env.py`：验证 env 注入。
- Modify `apps/web/electron/features/backend/backend-process.ts`：`getBrowserctlEnv` 注入 `BROWSER_RUNTIME_BACKEND_URL`。
- Modify `apps/server/build-in-skills/browser-runtime/SKILL.md` + `reference.md`：教 `open-artifact`。

---

## Task 1: browserctl `open-artifact` 命令

**Files:** Modify `packages/browserctl/src/index.js`; Test `packages/browserctl/test/index.test.js`

- [ ] **Step 1: 写失败测试**（追加到 `test/index.test.js`，沿用其 mock bridge + runCli 模式）

```javascript
test("open-artifact 用 CONVERSATION_ID + BACKEND_URL 拼 static URL 并 navigate", async () => {
  let reqUrl, body
  const srv = await startServer(async (req, res) => {
    reqUrl = req.url
    body = JSON.parse(await readBody(req))
    res.end(JSON.stringify({ ok: true, data: {} }))
  })
  try {
    await runCli(["open-artifact", "/artifacts/report.html"], {
      env: {
        BROWSER_RUNTIME_BRIDGE_URL: urlOf(srv),
        CONVERSATION_ID: "42",
        BROWSER_RUNTIME_BACKEND_URL: "http://127.0.0.1:34567",
      },
    })
    assert.ok(reqUrl.endsWith("/navigate"))
    assert.equal(
      body.url,
      "http://127.0.0.1:34567/chat/conversations/42/resources/static/artifacts/report.html"
    )
  } finally {
    await closeServer(srv)
  }
})

test("open-artifact 去掉 virtualPath 前导斜杠避免双斜杠", async () => {
  let body
  const srv = await startServer(async (req, res) => {
    body = JSON.parse(await readBody(req))
    res.end(JSON.stringify({ ok: true, data: {} }))
  })
  try {
    await runCli(["open-artifact", "artifacts/a.html"], {
      env: {
        BROWSER_RUNTIME_BRIDGE_URL: urlOf(srv),
        CONVERSATION_ID: "1",
        BROWSER_RUNTIME_BACKEND_URL: "http://127.0.0.1:34567",
      },
    })
    assert.equal(
      body.url,
      "http://127.0.0.1:34567/chat/conversations/1/resources/static/artifacts/a.html"
    )
  } finally {
    await closeServer(srv)
  }
})

test("open-artifact 缺 CONVERSATION_ID 报错且不发请求", async () => {
  let hit = false
  const srv = await startServer((req, res) => {
    hit = true
    res.end(JSON.stringify({ ok: true }))
  })
  try {
    const { stdout } = await runCli(["open-artifact", "/artifacts/a.html"], {
      env: { BROWSER_RUNTIME_BRIDGE_URL: urlOf(srv) }, // 无 CONVERSATION_ID
    })
    const j = JSON.parse(stdout)
    assert.equal(j.ok, false)
    assert.equal(j.code, "MISSING_CONVERSATION_ID")
    assert.equal(hit, false)
  } finally {
    await closeServer(srv)
  }
})
```

- [ ] **Step 2: 跑测试确认失败** `cd packages/browserctl && node --test` → 新用例 FAIL

- [ ] **Step 3: 实现命令**（在 `run()` 的 `open`/`navigate` 分支附近新增；usage 也加一行）

```javascript
if (command === "open-artifact") {
  const virtualPath = rest[0]
  if (!virtualPath) throw new Error("virtual path required")
  const conversationId = process.env.CONVERSATION_ID
  if (!conversationId) {
    print(
      {
        ok: false,
        error:
          "CONVERSATION_ID env not set; cannot resolve which conversation's artifacts to open",
        code: "MISSING_CONVERSATION_ID",
      },
      flags.pretty
    )
    return
  }
  const backendBase = (
    process.env.BROWSER_RUNTIME_BACKEND_URL || "http://127.0.0.1:34567"
  ).replace(/\/$/, "")
  const rel = String(virtualPath).replace(/^\//, "")
  const url = `${backendBase}/chat/conversations/${conversationId}/resources/static/${rel}`
  print(await postAction("navigate", { url }), flags.pretty)
  return
}
```
usage() 加：`  browserctl open-artifact <virtual-path>   # 打开会话产物目录里的 HTML 到内嵌浏览器`

> 注意：`MISSING_CONVERSATION_ID` 走 `print({ok:false,...})`（与 CLI 其它结构化错误一致），不要 `throw`（throw 会变成 CLI_USAGE_ERROR）。缺 backend URL 时用默认 `http://127.0.0.1:34567`（dev/打包由 Electron 注入准确值）。

- [ ] **Step 4: 跑测试确认通过** `cd packages/browserctl && node --test` → 全绿（含原有 14 + 新 3）

- [ ] **Step 5: 提交**
```bash
git add packages/browserctl/src/index.js packages/browserctl/test/index.test.js
git commit -m "feat(browserctl): add open-artifact command to open conversation HTML in browser-panel"
```

---

## Task 2: 后端 shell backend 注入 CONVERSATION_ID

**Files:** Modify `apps/server/src/service/skill_shell_backend.py`, `apps/server/src/service/agent/employee.py`, `apps/server/src/service/agent/orchestrator/agent.py`; Test `apps/server/tests/test_shell_conversation_env.py`

- [ ] **Step 1: 写失败测试**

```python
# apps/server/tests/test_shell_conversation_env.py
from pathlib import Path
from src.service.skill_shell_backend import SkillAwareShellBackend


def _mk(tmp_path, conversation_id):
    return SkillAwareShellBackend(
        root_dir=str(tmp_path),
        skills_root=tmp_path,
        draft_root=None,
        conversation_id=conversation_id,
    )


def test_conversation_id_injected_into_env(tmp_path):
    be = _mk(tmp_path, 42)
    assert be._env.get("CONVERSATION_ID") == "42"


def test_no_conversation_id_means_no_env(tmp_path):
    be = _mk(tmp_path, None)
    assert "CONVERSATION_ID" not in be._env
```

- [ ] **Step 2: 跑失败** `cd apps/server && uv run pytest tests/test_shell_conversation_env.py -v` → FAIL（`conversation_id` 不是合法参数）

- [ ] **Step 3: 实现**
  - `skill_shell_backend.py` `__init__` 签名加 `conversation_id: int | str | None = None`（放在现有关键字参数中），在 `__init__` 体内（`super().__init__` 之后、设置 `self._env` 相关逻辑处）加：
    ```python
    if conversation_id is not None and str(conversation_id) != "":
        self._env["CONVERSATION_ID"] = str(conversation_id)
    ```
    （确认 `self._env` 此时已由父类初始化；本仓在 `__init__` 里已对 `self._env` 做过 `setdefault`，在其附近注入即可。）
  - `employee.py:182` 与 `orchestrator/agent.py`（约 205）的 `SkillAwareShellBackend(...)` 调用加一行参数：`conversation_id=conversation_id,`（两处都有 `conversation_id` 变量在作用域）。

- [ ] **Step 4: 跑通过** `cd apps/server && uv run pytest tests/test_shell_conversation_env.py -v` → 2 passed

- [ ] **Step 5: 提交**
```bash
git add apps/server/src/service/skill_shell_backend.py apps/server/src/service/agent/employee.py apps/server/src/service/agent/orchestrator/agent.py apps/server/tests/test_shell_conversation_env.py
git commit -m "feat(server): inject CONVERSATION_ID into shell env for browserctl open-artifact"
```

---

## Task 3: Electron 注入 BROWSER_RUNTIME_BACKEND_URL

**Files:** Modify `apps/web/electron/features/backend/backend-process.ts`

- [ ] **Step 1: 实现**（`getBrowserctlEnv()` 的返回对象加一项；`BACKEND_PORT` 是同文件常量，行 14）

```typescript
return {
  BROWSERCTL_PATH: indexPath,
  BROWSERCTL_NODE: app.isPackaged ? process.execPath : "node",
  // open-artifact 用：指向后端，拼会话产物静态 URL（区别于 bridge 的 34555）
  BROWSER_RUNTIME_BACKEND_URL: `http://127.0.0.1:${BACKEND_PORT}`,
  [pathKey]: `${binDir}${path.delimiter}${process.env[pathKey] ?? ""}`,
}
```

- [ ] **Step 2: typecheck** `pnpm --filter digital-employee typecheck` → 通过

- [ ] **Step 3: 提交**
```bash
git add apps/web/electron/features/backend/backend-process.ts
git commit -m "feat(electron): inject BROWSER_RUNTIME_BACKEND_URL for browserctl open-artifact"
```

---

## Task 4: SKILL 文档

**Files:** Modify `apps/server/build-in-skills/browser-runtime/SKILL.md`, `reference.md`

- [ ] **Step 1: 文档**
  - SKILL.md 常用命令块加：`browserctl open-artifact /artifacts/report.html   # 打开产物目录里的 HTML（不依赖文件卡片）`
  - 在工作流/说明里点明：当对话生成/复制/编辑了产物 HTML 又没有可点的文件卡片时，用 `open-artifact <虚拟路径>` 直接在内嵌浏览器打开；会话自动识别，无需传 id。
  - reference.md 命令表加 `open-artifact` 行 + 错误码 `MISSING_CONVERSATION_ID`。

- [ ] **Step 2: 提交**
```bash
git add apps/server/build-in-skills/browser-runtime/SKILL.md apps/server/build-in-skills/browser-runtime/reference.md
git commit -m "docs(browser-runtime): document open-artifact command"
```

---

## Task 5: 手动 E2E（需 GUI）

- [ ] 重启 `dev:app`
- [ ] 让 Agent（挂 browser-runtime）对一个**产物目录里已存在、但没有文件卡片**的 HTML 说"打开它" → Agent 执行 `browserctl open-artifact /artifacts/xxx.html` → 右栏自动展开并渲染
- [ ] 带相对资源的产物 HTML → 样式/脚本生效
- [ ] 打开后 `browserctl snapshot --interactive` 能交互
- [ ] 两个会话并发各自 open-artifact → 各自 URL 内容正确（窗口共享是已知限制，仅显示层互抢）

---

## 完成定义
- browserctl `node --test` 全绿（原 14 + 新 3）
- `test_shell_conversation_env.py` 2 passed
- `pnpm --filter digital-employee typecheck` 通过
- 手动 E2E 通过
